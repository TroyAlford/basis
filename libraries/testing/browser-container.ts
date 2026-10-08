/**
 * Docker-backed Playwright browser for Basis snapshot capture.
 *
 * Basis never launches a browser on the host. Every snapshot capture runs
 * through a container pinned to the installed Playwright version
 * (`mcr.microsoft.com/playwright:v<version>-noble`), which carries the browser,
 * its operating-system libraries, and its fonts. Rendering is therefore
 * identical on every host and in CI, and a host needs only Docker — never
 * `playwright install-deps`, sudo, or a matching set of system libraries.
 *
 * The container runs Playwright's own server (`playwright run-server`) from the
 * **mounted** Playwright package, so it needs no in-container package download:
 * the image already has the browsers and the package is bind-mounted read-only
 * from the installation that resolved it. The host connects with
 * `chromium.connect(...)` and `exposeNetwork: '<loopback>'`, which lets the
 * containerised browser reach the loopback application server `useApplication`
 * starts on the host without host networking.
 *
 * The module separates the pure argv/image/command builders from the
 * side-effecting start/stop, so the shape is testable without a Docker daemon.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Image repository for the pinned Playwright browser. */
const IMAGE_REPOSITORY = 'mcr.microsoft.com/playwright'

/** Image variant: Ubuntu 24.04 (Noble Numbat). */
const IMAGE_VARIANT = 'noble'

/** Container path the host's Playwright packages are mounted under. */
const MOUNT_ROOT = '/opt/basis-playwright'

/** Message prefix shared by container failures. */
const PREFIX = '[basis]'

/** A captured `docker` invocation result. */
export interface DockerResult {
  /** Process exit code; zero means success. */
  readonly exitCode: number,
  /** Captured standard error. */
  readonly stderr: string,
  /** Captured standard output. */
  readonly stdout: string,
}

/** Runs a `docker` subcommand and captures its output. */
export type DockerRunner = (args: readonly string[]) => DockerResult

/** Resolved host directories bind-mounted into the container. */
export interface PlaywrightPackages {
  /** Host directory of the installed `playwright-core` package. */
  readonly coreDir: string,
  /** Host directory of the installed `playwright` package. */
  readonly playwrightDir: string,
}

/**
 * Turn an unknown thrown value into a message.
 * @param error - The thrown value.
 * @returns The error's message, or the value stringified.
 */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The first non-empty line of a captured stream, or an empty string.
 * @param text - Captured command output.
 * @returns The first non-empty trimmed line, or an empty string.
 */
function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}

/**
 * The default runner: the `docker` resolved on `PATH`, through Bun.
 *
 * A missing `docker` binary throws from `Bun.spawnSync`; that is wrapped with
 * the same remediation as a daemon failure, so a host without Docker gets one
 * clear instruction rather than a raw `ENOENT`.
 * @param args - Arguments passed to `docker`.
 * @returns The captured result.
 * @throws {Error} When `docker` cannot be executed at all.
 */
export const runDocker: DockerRunner = args => {
  let result: ReturnType<typeof Bun.spawnSync>
  try {
    result = Bun.spawnSync(['docker', ...args], { stderr: 'pipe', stdout: 'pipe' })
  } catch (error) {
    throw new Error(`${PREFIX} ${DOCKER_HELP} (${message(error)})`, { cause: error })
  }
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  }
}

/** Remediation shown whenever the Docker-backed capture cannot run. */
export const DOCKER_HELP =
  'Basis snapshot capture always runs through Docker. Install and start Docker, ' +
  'and declare `docker` in this repository\'s `basis.hostDependencies`.'

/**
 * Resolve the installed Playwright version.
 *
 * The container image is pinned to it, so the server and the connecting client
 * are the same Playwright build — which `chromium.connect` requires.
 * @returns The installed Playwright version.
 * @throws {Error} When Playwright or its version cannot be resolved.
 */
export function resolvePlaywrightVersion(): string {
  const manifest = Bun.resolveSync('playwright/package.json', import.meta.dir)
  const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown }
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error(`${PREFIX} could not read the Playwright version from ${manifest}.`)
  }
  return parsed.version
}

/**
 * Resolve the host directories of the installed Playwright packages.
 *
 * They are bind-mounted into the container so `run-server` needs no download,
 * and resolved from the installation that `playwright/package.json` belongs to.
 * @returns The `playwright` and `playwright-core` directories.
 */
export function resolvePlaywrightPackages(): PlaywrightPackages {
  const playwrightDir = dirname(Bun.resolveSync('playwright/package.json', import.meta.dir))
  const coreDir = dirname(Bun.resolveSync('playwright-core/package.json', import.meta.dir))
  return { coreDir, playwrightDir }
}

/**
 * The pinned container image for a Playwright version.
 * @param version - A Playwright version, e.g. `1.63.0`.
 * @returns The image reference, e.g. `mcr.microsoft.com/playwright:v1.63.0-noble`.
 */
export function playwrightImage(version: string): string {
  return `${IMAGE_REPOSITORY}:v${version}-${IMAGE_VARIANT}`
}

/**
 * Build the `docker run` argv for the pinned Playwright server.
 * @param options - Container identity, image, ports, and mounted packages.
 * @param options.hostPort - Loopback host port to publish the server on.
 * @param options.image - The pinned Playwright image reference.
 * @param options.name - Container name.
 * @param options.packages - Host directories bind-mounted into the container.
 * @returns The `docker run` argv.
 */
export function browserContainerArgs(options: {
  readonly hostPort: number,
  readonly image: string,
  readonly name: string,
  readonly packages: PlaywrightPackages,
}): string[] {
  const { hostPort, image, name, packages } = options
  const modules = `${MOUNT_ROOT}/node_modules`
  return [
    'run',
    '--detach',
    '--init',
    '--rm',
    /*
     * Host networking, so the containerised browser reaches the application
     * server `useApplication` starts on host loopback directly — no per-request
     * proxy hop — and the server's port is the host port. The container is a
     * Linux-only test dependency, so host networking is available.
     */
    '--network=host',
    '--name', name,
    '--volume', `${packages.playwrightDir}:${modules}/playwright:ro`,
    '--volume', `${packages.coreDir}:${modules}/playwright-core:ro`,
    image,
    'node', `${modules}/playwright/cli.js`,
    'run-server', '--port', String(hostPort), '--host', '0.0.0.0',
  ]
}

/** A running Playwright browser container. */
export interface BrowserContainer {
  /** WebSocket endpoint the host Playwright client connects to. */
  readonly endpoint: string,
  /** Container name, for diagnostics and cleanup. */
  readonly name: string,
  /** Stop and remove the container; idempotent. */
  stop(): void,
}

/** Options accepted by {@link startBrowserContainer}. */
export interface StartContainerOptions {
  /** Host port to publish the server on; defaults to a free loopback port. */
  readonly hostPort?: number,
  /** Container name; defaults to a unique name for this process. */
  readonly name?: string,
  /** Resolved packages; defaults to the installed installation. */
  readonly packages?: PlaywrightPackages,
  /** Docker runner; defaults to {@link runDocker}. */
  readonly runner?: DockerRunner,
  /** Playwright version; defaults to the installed one. */
  readonly version?: string,
}

let containerSequence = 0

/**
 * A container name unique to this process and start.
 * @returns The container name.
 */
function nextContainerName(): string {
  containerSequence += 1
  return `basis-playwright-${process.pid}-${containerSequence}`
}

/**
 * Reserve a free loopback port by binding to port 0, then releasing it.
 * @returns The reserved port.
 */
function freePort(): number {
  const probe = Bun.serve({
    fetch: () => new Response(null, { status: 204 }),
    hostname: '127.0.0.1',
    port: 0,
  })
  const { port } = probe
  probe.stop(true)
  return port
}

/**
 * Start the pinned Playwright server in a container.
 *
 * `docker run` pulls the image when it is absent, so the first call on a host
 * is a one-time image download and later calls start in a couple of seconds.
 * @param options - Version, packages, port, name, and runner overrides.
 * @returns A handle with the connection endpoint and an idempotent `stop`.
 * @throws {Error} When Docker is unavailable or the container cannot start.
 */
export function startBrowserContainer(options: StartContainerOptions = {}): BrowserContainer {
  const runner = options.runner ?? runDocker
  const version = options.version ?? resolvePlaywrightVersion()
  const packages = options.packages ?? resolvePlaywrightPackages()
  const image = playwrightImage(version)
  const name = options.name ?? nextContainerName()
  const hostPort = options.hostPort ?? freePort()
  const result = runner(browserContainerArgs({ hostPort, image, name, packages }))

  if (result.exitCode !== 0) {
    const detail = firstLine(result.stderr) || `exit ${result.exitCode}`
    throw new Error(`${PREFIX} could not start the snapshot browser container from ${image}: ${detail}. ${DOCKER_HELP}`)
  }

  return {
    endpoint: `ws://127.0.0.1:${hostPort}/`,
    name,
    stop: () => { stopBrowserContainer(name, runner) },
  }
}

/**
 * Stop and remove a browser container.
 *
 * Best effort by design: teardown runs on success, failure, and signals, and
 * must never mask the real outcome with a cleanup error. A missing container is
 * a no-op.
 * @param name - Container name.
 * @param runner - Docker runner; defaults to {@link runDocker}.
 */
export function stopBrowserContainer(name: string, runner: DockerRunner = runDocker): void {
  try {
    runner(['rm', '--force', name])
  } catch {
    // Teardown is best effort; never mask the run's real result.
  }
}

/** Fixed container name so every `--parallel` worker reuses one browser. */
const SHARED_CONTAINER_NAME = 'basis-playwright'

/** Fixed loopback port for the shared container's server. */
const SHARED_PORT = 42987

/** Loopback endpoint of the shared browser server. */
export const SHARED_ENDPOINT = `ws://127.0.0.1:${SHARED_PORT}/`

/**
 * Directory holding the shared container's cross-process coordination state.
 * @returns The state directory path.
 */
function stateDir(): string {
  return join(tmpdir(), 'basis-playwright')
}

/**
 * Run a critical section under a cross-process lock.
 *
 * `--parallel` workers are separate processes, so the shared container's user
 * count needs a filesystem lock. A lock older than {@link LOCK_STALE_MS} is
 * treated as abandoned and taken over.
 * @param fn - The critical section.
 * @returns The section's result.
 */
async function withLock<T>(fn: () => T): Promise<T> {
  const directory = stateDir()
  mkdirSync(directory, { recursive: true })
  const lock = join(directory, 'lock')
  const deadline = Date.now() + LOCK_STALE_MS

  for (;;) {
    try {
      mkdirSync(lock)
      break
    } catch {
      if (Date.now() >= deadline) {
        rmSync(lock, { force: true, recursive: true })
        continue
      }
      await Bun.sleep(25)
    }
  }

  try {
    return fn()
  } finally {
    rmSync(lock, { force: true, recursive: true })
  }
}

/** How long to wait for a lock before assuming it was abandoned. */
const LOCK_STALE_MS = 30_000

/**
 * The shared container's active-worker count.
 * @returns The count, or zero when unset.
 */
function readCount(): number {
  try {
    return Number(readFileSync(join(stateDir(), 'count'), 'utf8')) || 0
  } catch {
    return 0
  }
}

/**
 * Whether the shared container is running.
 * @param runner - Docker runner.
 * @returns True when Docker reports it running.
 */
function isSharedRunning(runner: DockerRunner): boolean {
  try {
    const result = runner(['inspect', '--format', '{{.State.Running}}', SHARED_CONTAINER_NAME])
    return result.exitCode === 0 && result.stdout.trim() === 'true'
  } catch {
    return false
  }
}

/**
 * Acquire the shared browser container, starting it when needed, and register
 * this process as a user.
 *
 * All `bun test --parallel` workers share one container: the first to need it
 * starts it, the rest reuse it, and it is removed when the last process
 * releases it. That keeps snapshot capture to **one container per run**
 * regardless of worker count.
 * @param options - Playwright version, packages, and runner overrides.
 * @returns The DevTools endpoint.
 * @throws {Error} When the container cannot be started.
 */
export async function acquireSharedBrowserContainer(options: StartContainerOptions = {}): Promise<string> {
  const runner = options.runner ?? runDocker
  const version = options.version ?? resolvePlaywrightVersion()
  const packages = options.packages ?? resolvePlaywrightPackages()
  const image = playwrightImage(version)

  if (!isSharedRunning(runner)) {
    const result = runner(browserContainerArgs({
      hostPort: SHARED_PORT,
      image,
      name: SHARED_CONTAINER_NAME,
      packages,
    }))
    // Another worker may have won the race; only fail if nothing is running.
    if (result.exitCode !== 0 && !isSharedRunning(runner)) {
      const detail = firstLine(result.stderr) || `exit ${result.exitCode}`
      throw new Error(`${PREFIX} could not start the snapshot browser from ${image}: ${detail}. ${DOCKER_HELP}`)
    }
  }

  await withLock(() => {
    writeFileSync(join(stateDir(), 'count'), String(readCount() + 1))
  })

  return SHARED_ENDPOINT
}

/**
 * Release the shared browser container; the last process removes it.
 * @param runner - Docker runner; defaults to {@link runDocker}.
 */
export async function releaseSharedBrowserContainer(runner: DockerRunner = runDocker): Promise<void> {
  await withLock(() => {
    const remaining = Math.max(0, readCount() - 1)
    if (remaining === 0) {
      rmSync(join(stateDir(), 'count'), { force: true })
      stopBrowserContainer(SHARED_CONTAINER_NAME, runner)
    } else {
      writeFileSync(join(stateDir(), 'count'), String(remaining))
    }
  })
}
