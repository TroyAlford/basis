import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright'

/*
 * Run-scoped snapshot runtime.
 *
 * Visual capture is expensive to start and cheap to reuse: one Docker
 * container running the pinned Playwright image, one browser connection, one
 * reusable page for React-element captures, and one short-lived context per
 * application visit. The runtime is memoised on `globalThis`, so every test
 * file in a Bun run resolves the same instance, and the testing preload tears it
 * down exactly once when the run ends.
 *
 * Capture always runs in the container, never in a host browser: local
 * development and CI render in the same image, so a snapshot cannot depend on
 * the host's Chromium build, operating-system libraries, or fonts. The browser
 * is lazy — a run that never captures a screenshot never starts Docker.
 */

/** Environment variable that, when set, receives one line per lifecycle event. */
export const SNAPSHOT_ACTIVITY_LOG = 'BASIS_SNAPSHOT_ACTIVITY_LOG'

/**
 * Remediation shown when the snapshot runtime cannot start.
 *
 * Capture runs Chromium inside the pinned Playwright container, so the runtime
 * needs a working Docker daemon — not a host browser or its system libraries.
 * This is the exact next step for a machine whose Docker is missing or stopped.
 */
export const DOCKER_UNAVAILABLE_HELP =
  'Visual snapshots run Chromium inside Docker. Basis pins ' +
  'mcr.microsoft.com/playwright:v<installed playwright>-noble so local development and CI ' +
  'render in the same browser; it never launches a host browser. Install Docker, make sure ' +
  'the daemon is running, and re-run.'

/**
 * Name the pinned container image for an installed Playwright version.
 * @param version - The installed Playwright version.
 * @returns The container image reference.
 */
export function playwrightImage(version: string): string {
  return `mcr.microsoft.com/playwright:v${version}-noble`
}

/**
 * Extract the remote browser endpoint from a container's run-server output.
 * @param log - The container's combined log output.
 * @returns The `ws://` endpoint, or null when no endpoint has been announced.
 */
export function parseServerEndpoint(log: string): string | null {
  return /Listening on (ws:\/\/\S+)/.exec(log)?.[1] ?? null
}

/**
 * Wrap a container or browser startup failure with actionable remediation.
 * @param cause - The error thrown while starting the runtime.
 * @returns The augmented error.
 */
export function dockerUnavailableError(cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new Error(`${DOCKER_UNAVAILABLE_HELP}\n\nUnderlying error: ${detail}`, { cause })
}

/** The mounted Playwright package and its core dependency, as host paths. */
interface PlaywrightMount {
  /** Absolute host path of the `playwright-core` package directory. */
  core: string,
  /** Absolute host path of the `playwright` package directory. */
  dir: string,
  /** The installed Playwright version. */
  version: string,
}

/**
 * Resolve the Playwright package the client will mount into the container.
 *
 * The client and the container must run the same Playwright version, so the
 * image tag and the mounted package both come from the installed dependency
 * rather than a constant. Resolution is relative to this module, so it follows
 * the consumer's dependency graph.
 * @returns The package directories and version.
 */
function playwrightMount(): PlaywrightMount {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('playwright/package.json')
  const dir = dirname(manifest)
  const { version } = JSON.parse(readFileSync(manifest, 'utf-8')) as { version: string }
  const core = dirname(createRequire(manifest).resolve('playwright-core/package.json'))
  return { core, dir, version }
}

/** Docker command result. */
interface DockerResult {
  /** Process exit code. */
  code: number,
  /** Combined standard error. */
  stderr: string,
  /** Combined standard output. */
  stdout: string,
}

/**
 * Run a Docker CLI command and capture its output.
 * @param args - Arguments after `docker`.
 * @returns The exit code and captured output.
 */
function docker(args: string[]): DockerResult {
  const proc = Bun.spawnSync(['docker', ...args], { stderr: 'pipe', stdout: 'pipe' })
  const decoder = new TextDecoder()
  return {
    code: proc.exitCode ?? -1,
    stderr: decoder.decode(proc.stderr),
    stdout: decoder.decode(proc.stdout),
  }
}

/** How long to wait for the container to announce its browser endpoint. */
const READY_TIMEOUT_MS = 60_000

/** How often to poll the container log while waiting for its endpoint. */
const READY_POLL_MS = 50

/**
 * Start the one snapshot container and wait for its remote browser endpoint.
 *
 * The container is detached and unnamed (Docker assigns the identity), runs the
 * mounted Playwright package's `run-server` on an ephemeral port, and shares the
 * host network so the containerised browser can reach the application server on
 * loopback. Nothing about the container is fixed: no name, no port, no state
 * outside the returned id.
 * @returns The container id and its browser endpoint.
 */
async function startContainer(): Promise<{ endpoint: string, id: string }> {
  const mount = playwrightMount()
  const image = playwrightImage(mount.version)
  const args = [
    'run', '-d', '--rm', '--pull', 'missing', '--network', 'host', '--ipc=host',
    '-e', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    '-v', `${mount.dir}:/opt/pw/node_modules/playwright:ro`,
    '-v', `${mount.core}:/opt/pw/node_modules/playwright-core:ro`,
    image,
    'node', '/opt/pw/node_modules/playwright/cli.js',
    'run-server', '--host', '127.0.0.1', '--port', '0',
  ]

  let run: DockerResult
  try {
    run = docker(args)
  } catch (error) {
    throw dockerUnavailableError(error)
  }
  if (run.code !== 0) {
    throw dockerUnavailableError(run.stderr.trim() || `docker run exited with ${run.code}`)
  }

  const id = run.stdout.trim()
  record(`container-start ${id}`)

  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const logs = docker(['logs', id])
    const output = `${logs.stdout}${logs.stderr}`
    const endpoint = parseServerEndpoint(output)
    if (endpoint) return { endpoint, id }
    if (logs.code !== 0) {
      throw dockerUnavailableError(output.trim() || 'the snapshot container exited before it was ready')
    }
    await Bun.sleep(READY_POLL_MS)
  }

  docker(['rm', '-f', id])
  throw dockerUnavailableError(
    `the snapshot container did not report an endpoint within ${READY_TIMEOUT_MS}ms`,
  )
}

/** The process-wide snapshot runtime, created on first capture. */
interface SnapshotRuntime {
  /** The one connected browser. */
  browser: Browser,
  /** Deterministic context reused for React-element captures. */
  captureContext: BrowserContext | null,
  /** Page reused for React-element captures. */
  capturePage: Page | null,
  /** Serialises element captures so concurrent test files do not interleave. */
  captureQueue: Promise<unknown>,
  /** The running container's id. */
  containerId: string,
}

/** The process-wide runtime registry. */
interface RuntimeRegistry {
  /** The runtime being started or already running. */
  runtime: Promise<SnapshotRuntime> | null,
  /** Whether teardown has run; guards idempotent close and post-close starts. */
  stopped: boolean,
}

/** The `globalThis` property that holds the run-scoped runtime registry. */
const REGISTRY_PROPERTY = '__basisSnapshotRuntime'

/**
 * The process-wide registry, created on first use.
 * @returns The shared registry.
 */
function registry(): RuntimeRegistry {
  const scope = globalThis as unknown as Record<string, unknown>
  const existing = scope[REGISTRY_PROPERTY] as RuntimeRegistry | undefined
  if (existing) return existing

  const created: RuntimeRegistry = { runtime: null, stopped: false }
  scope[REGISTRY_PROPERTY] = created
  return created
}

/**
 * Append a lifecycle event when the activity log is enabled.
 *
 * This is observability for the runtime's lifecycle test, not coordination:
 * with no `BASIS_SNAPSHOT_ACTIVITY_LOG` set it is inert, and a failed write
 * never fails a snapshot.
 * @param event - The event line to record.
 */
function record(event: string): void {
  const path = process.env[SNAPSHOT_ACTIVITY_LOG]
  if (!path) return
  try {
    appendFileSync(path, `${event}\n`)
  } catch {
    // Observability only; a failed log must never fail a snapshot.
  }
}

/**
 * Start the runtime: one container, one browser connection.
 * @returns The running runtime.
 */
async function startRuntime(): Promise<SnapshotRuntime> {
  const { endpoint, id } = await startContainer()

  const { chromium } = await import('playwright')
  let browser: Browser
  try {
    browser = await chromium.connect(endpoint)
  } catch (error) {
    docker(['rm', '-f', id])
    throw dockerUnavailableError(error)
  }

  record('browser-connect')
  return {
    browser,
    captureContext: null,
    capturePage: null,
    captureQueue: Promise.resolve(),
    containerId: id,
  }
}

/**
 * Resolve the run-scoped runtime, starting it on first use.
 *
 * Every caller in the process awaits the same promise, so the first capture
 * starts one container and one browser and every later capture reuses them.
 * @returns The shared runtime.
 * @throws {Error} When called after the runtime has been stopped.
 */
async function ensureRuntime(): Promise<SnapshotRuntime> {
  const scope = registry()
  if (scope.stopped) {
    throw new Error('the snapshot runtime cannot start after it was stopped')
  }

  if (!scope.runtime) {
    scope.runtime = startRuntime()
    // Avoid an unhandled rejection when a caller never awaits the runtime.
    void scope.runtime.catch(() => undefined)
  }

  return await scope.runtime
}

/**
 * The one browser every capture in the run shares.
 * @returns The connected browser.
 */
export async function getBrowser(): Promise<Browser> {
  return (await ensureRuntime()).browser
}

/**
 * Close the browser and remove the container, once.
 *
 * Idempotent, so the preload's end-of-run teardown and an interruption handler
 * cannot double-close. A run that never captured never started Docker, so this
 * is a no-op.
 */
export async function closeRuntime(): Promise<void> {
  const scope = registry()
  if (scope.stopped) return
  scope.stopped = true

  const pending = scope.runtime
  scope.runtime = null
  if (!pending) return

  const runtime = await pending.catch(() => null)
  if (!runtime) return

  await runtime.captureContext?.close().catch(() => undefined)
  await runtime.browser.close().catch(() => undefined)
  docker(['rm', '-f', runtime.containerId])
  record('teardown')
}

/** The deterministic context options shared by capture and visits. */
const CONTEXT_OPTIONS: BrowserContextOptions = {
  colorScheme: 'light',
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  viewport: { height: 800, width: 1280 },
}

/**
 * Run a React-element capture on the shared page, one at a time.
 *
 * Element captures are standalone documents, so re-creating a context and page
 * per capture is pure overhead — the dominant cost of a large icon matrix.
 * Reusing one page and replacing its document is deterministic, and the queue
 * keeps concurrent test files from interleaving on it. Application `visit`s
 * still open a fresh context on the same browser, so server/browser state cannot
 * leak between them.
 * @param fn - Callback receiving the shared page.
 * @returns The callback's result.
 */
export async function withCapturePage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const runtime = await ensureRuntime()
  const run = runtime.captureQueue.then(async () => {
    if (!runtime.capturePage || runtime.capturePage.isClosed()) {
      runtime.captureContext ??= await runtime.browser.newContext(CONTEXT_OPTIONS)
      runtime.capturePage = await runtime.captureContext.newPage()
    }
    return await fn(runtime.capturePage)
  })
  runtime.captureQueue = run.then(() => undefined, () => undefined)
  return await run
}

/** A viewport size. */
export interface Viewport {
  /** Viewport height in pixels. */
  height: number,
  /** Viewport width in pixels. */
  width: number,
}

/** Options for {@link withPage}. */
export interface PageOptions {
  /** Additional Playwright context options, merged over the deterministic defaults. */
  context?: BrowserContextOptions,
  /** Viewport size. Defaults to `1280x800`. */
  viewport?: Viewport,
}

/**
 * Open a deterministically configured page on the shared browser, run a
 * callback, then dispose the page and its context.
 * @param fn - Callback receiving the page.
 * @param options - Context options.
 * @returns The callback's result.
 */
export async function withPage<T>(
  fn: (page: Page) => Promise<T>,
  options: PageOptions = {},
): Promise<T> {
  const browser = await getBrowser()
  const context = await browser.newContext({
    ...CONTEXT_OPTIONS,
    ...(options.viewport ? { viewport: options.viewport } : {}),
    ...options.context,
  })
  try {
    return await fn(await context.newPage())
  } finally {
    await context.close()
  }
}
