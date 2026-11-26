import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { reapInstallRoots } from './containers'

/**
 * Temp-directory environment variables, in the order `os.tmpdir()` consults
 * them. Redirecting all three keeps `os.tmpdir()` — and therefore `mkdtemp`,
 * and any dependency or spawned child that uses either — inside the project
 * temp root.
 */
const TEMP_ENV_KEYS = ['TMPDIR', 'TMP', 'TEMP'] as const

/** Project metadata directory. */
const METADATA = '.basis'
/** Temp child under the project metadata directory. */
const TEMP = 'tmp'
/** Subdirectory recording the test processes sharing the temp root. */
const OWNERS = '.owners'

/** The invocation directory captured before any test can change it. */
const INVOCATION_ROOT = resolve(process.cwd())

/** The project-local temp root: `<invocation>/.basis/tmp`. */
const TEMP_ROOT = join(INVOCATION_ROOT, METADATA, TEMP)

/** Whether this process has isolated its temp directories. */
let isolated = false

/** How many times each fixture name has been used in this process. */
const used = new Map<string, number>()

/** The temp-directory environment values to restore when the run ends. */
const savedEnv = new Map<string, string | undefined>()

/**
 * Whether one host process is still alive.
 * @param pid - Process id.
 * @returns `true` when the process exists.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * The directory holding this run's owner markers.
 * @returns The absolute owner-marker directory.
 */
function ownerDirectory(): string {
  return join(TEMP_ROOT, OWNERS)
}

/**
 * Register this process as a user of the project temp root.
 */
function registerOwner(): void {
  mkdirSync(ownerDirectory(), { recursive: true })
  writeFileSync(join(ownerDirectory(), String(process.pid)), String(Date.now()))
}

/**
 * Remove owner markers left by processes that already exited.
 */
function removeStaleOwners(): void {
  let entries: string[]
  try {
    entries = readdirSync(ownerDirectory())
  } catch {
    return
  }
  for (const entry of entries) {
    const pid = Number(entry)
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) continue
    rmSync(join(ownerDirectory(), entry), { force: true })
  }
}

/**
 * Whether any other live process is using the project temp root.
 * @returns `true` when another live owner remains.
 */
function otherOwnersAlive(): boolean {
  let entries: string[]
  try {
    entries = readdirSync(ownerDirectory())
  } catch {
    return false
  }
  return entries.some(entry => {
    const pid = Number(entry)
    return Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid)
  })
}

/**
 * Point the process temp directory at `./.basis/tmp`.
 *
 * The testing preload calls this before the suite, so `os.tmpdir()` — and every
 * `mkdtemp` call, dependency, or spawned child that resolves through it — writes
 * inside the project. The root sits beside the checkout, so one project's run
 * cannot see another project's temp files. Calling it again is a no-op.
 * @returns The absolute project temp root.
 */
export function isolateTempDirectories(): string {
  if (isolated) return TEMP_ROOT
  mkdirSync(TEMP_ROOT, { recursive: true })
  removeStaleOwners()
  registerOwner()
  for (const key of TEMP_ENV_KEYS) {
    savedEnv.set(key, process.env[key])
    process.env[key] = TEMP_ROOT
  }
  isolated = true
  return TEMP_ROOT
}

/**
 * Create one deterministic temp directory under `./.basis/tmp`.
 *
 * The directory name is the caller's label — `tempDirectory('some-test')`
 * creates `./.basis/tmp/some-test` — so a test owns the same path every run.
 * Reusing a name clears the previous contents (and any managed PostgreSQL
 * container installed there), which keeps a killed run from contaminating the
 * next one. A second use of the same name in one process gets a numeric suffix
 * (`some-test-2`) so independent fixtures never share a directory.
 * @param prefix - Deterministic directory name, normally the test's name.
 * @returns The absolute directory path.
 */
export function tempDirectory(prefix: string): string {
  const count = (used.get(prefix) ?? 0) + 1
  used.set(prefix, count)
  const directory = join(isolateTempDirectories(), count === 1 ? prefix : `${prefix}-${count}`)
  if (existsSync(directory)) {
    if (Bun.which('docker')) reapInstallRoots([directory])
    rmSync(directory, { force: true, recursive: true })
  }
  mkdirSync(directory, { recursive: true })
  return directory
}

/**
 * Remove the project temp root and restore the temp environment.
 *
 * A run may share `./.basis/tmp` with sibling test processes. The root is
 * removed only when this is the last live owner; until then it leaves the
 * other processes' fixtures intact. Removing the root also removes every
 * managed container and named volume installed below it, so a normal teardown
 * leaves neither Docker resources nor temp files behind. Idempotent.
 */
export function cleanupTempDirectories(): void {
  if (!isolated && savedEnv.size === 0) return
  for (const [key, value] of savedEnv) {
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
  savedEnv.clear()
  isolated = false
  rmSync(join(ownerDirectory(), String(process.pid)), { force: true })
  if (otherOwnersAlive()) return
  if (Bun.which('docker')) reapInstallRoots([TEMP_ROOT])
  rmSync(TEMP_ROOT, { force: true, recursive: true })
}

/**
 * The project temp root, for callers that need to reap or inspect it.
 * @returns The absolute `<invocation>/.basis/tmp` path.
 */
export function tempRoot(): string {
  return TEMP_ROOT
}
