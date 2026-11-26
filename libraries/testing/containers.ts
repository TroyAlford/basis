import { Logger } from 'basis/logger'
import type { CommandResult } from 'basis/utilities'
import { run } from 'basis/utilities'
import { resolve, sep } from 'node:path'

/** Label marking a Docker resource as owned by a test run. */
const TEST_LABEL = 'basis.test'
/** Label recording the host process that owns the test resource. */
const OWNER_LABEL = 'basis.test.owner'
/** Label recording the installation directory that owns a managed resource. */
const INSTALL_LABEL = 'basis.install'

/** A synchronous command runner whose output can be supplied by a test. */
export type CommandRunner = (command: string, args: readonly string[]) => CommandResult

/** Quiet runner used by housekeeping sweeps so cleanup never adds test noise. */
const quiet = new Logger({ silent: true })

/** One listed Docker resource and the value of the label being read. */
interface ListedResource {
  /** Container id or volume name. */
  readonly id: string,
  /** The requested label value, or an empty string when absent. */
  readonly label: string,
}

/** Whether the fixture sweep has already run in this process. */
let swept = false

/**
 * Run one Docker command without logging.
 * @param command - Executable name.
 * @param args - Command arguments.
 * @returns The captured result.
 */
const defaultRunner: CommandRunner = (command, args) => run(command, args, { logger: quiet })

/**
 * Docker labels applied to every run-scoped test container.
 * @returns The `docker` label arguments.
 */
export function testContainerLabels(): readonly string[] {
  return [
    '--label', `${TEST_LABEL}=1`,
    '--label', `${OWNER_LABEL}=${process.pid}`,
  ]
}

/**
 * Whether one host process is still alive.
 * @param pid - Host process id.
 * @returns `true` when the process exists.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Split one tab-separated `--format` row into a resource id and label value.
 * @param line - One output line.
 * @returns The resource id and label value.
 */
function splitRow(line: string): ListedResource {
  const [id = '', label = ''] = line.split('\t')
  return { id, label }
}

/**
 * List containers matching a filter, with one label value per row.
 * @param runner - Command runner.
 * @param filter - Docker label filter expression.
 * @param label - Label key to read.
 * @returns The matching containers.
 */
function listContainers(
  runner: CommandRunner,
  filter: string,
  label: string,
): readonly ListedResource[] {
  const format = `{{.ID}}\t{{.Label "${label}"}}`
  const result = runner('docker', ['ps', '-a', '--filter', filter, '--format', format])
  return result.lines.map(splitRow)
}

/**
 * List volumes matching a filter, with one label value per row.
 * @param runner - Command runner.
 * @param filter - Docker label filter expression.
 * @param label - Label key to read.
 * @returns The matching volumes.
 */
function listVolumes(
  runner: CommandRunner,
  filter: string,
  label: string,
): readonly ListedResource[] {
  const format = `{{.Name}}\t{{.Label "${label}"}}`
  const result = runner('docker', ['volume', 'ls', '--filter', filter, '--format', format])
  return result.lines.map(splitRow)
}

/**
 * Whether a path is one root exactly or lives below it.
 * @param candidate - Candidate installation path.
 * @param root - Temp root the current process owns.
 * @returns `true` when the candidate is inside the root.
 */
function within(candidate: string, root: string): boolean {
  const base = resolve(root)
  const path = resolve(candidate)
  return path === base || path.startsWith(`${base}${sep}`)
}

/**
 * Remove test containers whose owning test process is gone.
 *
 * A process cannot handle `SIGKILL`, so the next test run removes abandoned
 * labeled containers and their anonymous volumes. Containers owned by a live
 * process are left alone.
 * @param runner - Command runner.
 */
export function reapDeadOwners(runner: CommandRunner = defaultRunner): void {
  for (const { id, label } of listContainers(runner, `label=${TEST_LABEL}=1`, OWNER_LABEL)) {
    const pid = Number(label)
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) continue
    void runner('docker', ['rm', '-f', '-v', id])
  }
}

/**
 * Remove managed containers and named volumes owned by this run's temp roots.
 *
 * Managed PostgreSQL resources are labeled with the installation root that
 * owns them. A fixture that runs inside a `basis-run-*` temp directory owns
 * every resource installed below that root, so this sweep removes exactly
 * those containers and volumes at teardown — including the named data volume,
 * which `docker rm -v` does not remove on its own.
 *
 * The sweep is scoped to the roots the current process created. A concurrent
 * run in another checkout, worktree, or sandbox — including one with a
 * different PID namespace or a private `/tmp` — owns different roots and is
 * never touched. Installations outside a run root (a worktree, an application
 * checkout, `BASIS_TEST_FIXTURE_ROOT`) are also never touched.
 * @param roots - Temp roots created by the current process.
 * @param runner - Command runner.
 */
export function reapInstallRoots(
  roots: readonly string[],
  runner: CommandRunner = defaultRunner,
): void {
  if (roots.length === 0) return
  const owned = (installation: string): boolean => (
    installation !== '' && roots.some(root => within(installation, root))
  )

  for (const { id, label } of listContainers(runner, `label=${INSTALL_LABEL}`, INSTALL_LABEL)) {
    if (!owned(label)) continue
    void runner('docker', ['rm', '-f', '-v', id])
  }

  for (const { id, label } of listVolumes(runner, `label=${INSTALL_LABEL}`, INSTALL_LABEL)) {
    if (!owned(label)) continue
    void runner('docker', ['volume', 'rm', '-f', id])
  }
}

/**
 * Reclaim test containers abandoned by an earlier run.
 *
 * Runs at most once per process, from the database and browser fixtures.
 * @param runner - Command runner, injectable for tests.
 */
export function reapDeadTestContainers(runner: CommandRunner = defaultRunner): void {
  if (swept) return
  swept = true
  reapDeadOwners(runner)
}
