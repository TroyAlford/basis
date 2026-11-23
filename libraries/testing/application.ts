import { createHash } from 'node:crypto'
import { get } from 'node:http'
import { resolve as resolvePath } from 'node:path'
import type { Page } from 'playwright'
import type { Viewport } from './browser'
import { withPage } from './browser'
import type { NetworkOptions } from './network'
import { installNetwork } from './network'

/** Options for {@link startApplication}. */
export interface StartApplicationOptions {
  /** Working directory for the server process. Defaults to `process.cwd()`. */
  cwd?: string,
  /** Run the development server so Bun owns HMR. Defaults to `false`. */
  development?: boolean,
  /** Path to the server entry module, relative to `cwd`. */
  entry: string,
  /** Extra environment for the server process. */
  env?: Record<string, string>,
  /** HTTP path polled for readiness. Defaults to `/api/health`. */
  readyPath?: string,
  /**
   * Decide whether a probed HTTP status means the application is ready.
   * Defaults to any 2xx or 3xx response. Error-state fixtures can accept a
   * known 5xx readiness response without bypassing the fixture lifecycle.
   */
  readyStatus?: (status: number) => boolean,
  /** Readiness timeout in milliseconds. Defaults to `30000`. */
  timeoutMs?: number,
}

/** Options for {@link ApplicationHandle.visit}. */
export interface VisitOptions extends NetworkOptions {
  /** Runs before navigation, for page setup such as `page.addInitScript(...)`. */
  init?: (page: Page) => unknown,
  /** Viewport override. */
  viewport?: Viewport,
}

/** A visit callback receiving the navigated page. */
export type VisitCallback<T> = (page: Page) => Promise<T> | T

/** A running application under test. */
export interface ApplicationHandle {
  /** Stop the application and return its child exit code; idempotent. */
  stop: () => Promise<number>,
  /** The base URL of the running application. */
  url: string,
  /**
   * Open a deterministic page at `path`, run a callback, then dispose it.
   *
   * Non-loopback requests are blocked unless allowed or stubbed, so a snapshot
   * cannot silently depend on a CDN. `options.init` runs before navigation.
   */
  visit: {
    <T>(path: string, fn: VisitCallback<T>): Promise<T>,
    <T>(path: string, options: VisitOptions, fn: VisitCallback<T>): Promise<T>,
  },
}

/**
 * Reserve a free loopback port by binding to port 0 and releasing it.
 * @returns The reserved port.
 */
async function freePort(): Promise<number> {
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
 * Probe a URL for an HTTP status, bypassing any test-global `fetch` shim.
 * @param url - URL to probe.
 * @returns The response status, or a rejection when the request fails.
 */
function httpStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = get(url, response => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    request.setTimeout(2_000, () => request.destroy(new Error('probe timeout')))
    request.on('error', reject)
  })
}

/**
 * Poll a URL until it answers successfully.
 * @param url - URL to poll.
 * @param timeoutMs - Readiness timeout.
 * @param output - Captured process output, included in the failure message.
 * @param ready - Predicate for an acceptable readiness status.
 */
async function waitForReady(
  url: string,
  timeoutMs: number,
  output: () => string,
  ready: (status: number) => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no response'

  while (Date.now() < deadline) {
    try {
      const status = await httpStatus(url)
      if (ready(status)) return
      lastError = `HTTP ${status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await Bun.sleep(100)
  }

  const tail = output().trim().split('\n').slice(-20).join('\n')
  throw new Error(
    `startApplication: ${url} was not ready within ${timeoutMs}ms (${lastError})` +
      (tail ? `\n--- server output ---\n${tail}` : ''),
  )
}

/**
 * Boot the application's server entry on an ephemeral loopback port.
 *
 * The entry is spawned as a child process (the same shape as a managed
 * deployment), so it can be the consumer's real server module. `HOST` and a
 * free `PORT` are injected; `NODE_ENV` defaults to `production` for
 * deterministic output and can be overridden through `env`.
 * @param options - Startup options.
 * @returns A handle with the base URL, an idempotent stop, and `visit`.
 */
export async function startApplication(
  options: StartApplicationOptions,
): Promise<ApplicationHandle> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await startApplicationOnce(options)
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('exited before ready')) throw error
      await Bun.sleep(50)
    }
  }
  throw lastError
}

/**
 * Boot one application attempt.
 * @param options - Startup options.
 * @returns A handle with the base URL, an idempotent stop, and `visit`.
 */
async function startApplicationOnce(
  options: StartApplicationOptions,
): Promise<ApplicationHandle> {
  const {
    cwd = process.cwd(),
    development = false,
    entry,
    env = {},
    readyPath = '/api/health',
    readyStatus = status => status >= 200 && status < 400,
    timeoutMs = 30_000,
  } = options
  const port = await freePort()
  const proc = Bun.spawn([process.execPath, entry], {
    cwd,
    env: {
      ...process.env,
      ...env,
      HOST: '127.0.0.1',
      NODE_ENV: env.NODE_ENV ?? (development ? 'development' : 'production'),
      PORT: String(port),
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })

  const decoder = new TextDecoder()
  let output = ''
  const drain = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    for await (const chunk of stream) output += decoder.decode(chunk)
  }
  void drain(proc.stdout)
  void drain(proc.stderr)

  const url = `http://127.0.0.1:${port}`
  let exitCode: number | null = null
  let exit: Promise<number> | null = null
  const exited = proc.exited.then(code => {
    exitCode = code
    return code
  })
  const stop = async (): Promise<number> => {
    if (exit) return exit
    proc.kill()
    exit = exited
    return exit
  }

  try {
    const ready = waitForReady(`${url}${readyPath}`, timeoutMs, () => output, readyStatus)
    void ready.catch(() => undefined)
    await Promise.race([
      ready,
      exited.then(code => {
        throw new Error(
          `startApplication: ${url} exited before ready (code ${code})` +
            (output.trim() ? `\n--- server output ---\n${output.trim()}` : ''),
        )
      }),
    ])
    /*
     * A different process can win the free port after the probe releases it.
     * If this child lost that race it exits immediately; retry with a new port
     * instead of handing the caller a dead URL.
     */
    await Bun.sleep(20)
    if (exitCode !== null) {
      throw new Error(
        `startApplication: ${url} exited before ready (code ${exitCode})` +
          (output.trim() ? `\n--- server output ---\n${output.trim()}` : ''),
      )
    }
  } catch (error) {
    await stop()
    throw error
  }

  return { stop, url, visit: createVisit(url) }
}

/**
 * Build the deterministic page visitor for one running application.
 * @param url - Base application URL.
 * @returns The visit function.
 */
function createVisit(url: string): ApplicationHandle['visit'] {
  return async <T>(
    path: string,
    optionsOrFn: VisitOptions | VisitCallback<T>,
    maybeFn?: VisitCallback<T>,
  ): Promise<T> => {
    const visitOptions: VisitOptions = typeof optionsOrFn === 'function' ? {} : optionsOrFn
    const callback = (typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn) as VisitCallback<T>

    return await withPage(async page => {
      await installNetwork(page, visitOptions)
      if (visitOptions.init) await visitOptions.init(page)
      await page.goto(`${url}${path}`, { waitUntil: 'load' })
      return await callback(page)
    }, { viewport: visitOptions.viewport })
  }
}

/** The normalized identity of one application fixture. */
interface ApplicationIdentity {
  /** Resolved application working directory. */
  readonly cwd: string,
  /** Effective server development mode. */
  readonly development: boolean,
  /** Resolved application entry. */
  readonly entry: string,
  /** Effective child environment. */
  readonly env: Readonly<Record<string, string>>,
}

/**
 * Build the normalized identity for one application.
 * @param options - Startup options.
 * @param cwd - Resolved working directory.
 * @param entry - Resolved entry.
 * @returns The normalized identity.
 */
function applicationIdentity(
  options: StartApplicationOptions,
  cwd: string,
  entry: string,
): ApplicationIdentity {
  return {
    cwd,
    development: options.development ?? false,
    entry,
    env: options.env ?? {},
  }
}

/**
 * Hash one normalized application identity.
 * @param identity - Normalized identity.
 * @returns A stable key.
 */
function applicationIdentityKey(identity: ApplicationIdentity): string {
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

/*
 * Run-scoped application fixture.
 *
 * `startApplication` is the low-level primitive. `useApplication` memoises one
 * handle per application identity for the whole Bun test process; the testing
 * preload stops every handle at teardown, including after failures and
 * `SIGINT`/`SIGTERM`. No application server outlives the run.
 */

/** The `globalThis` property that holds the process-wide application registry. */
const REGISTRY_PROPERTY = '__basisTestingApplications'

/** The process-local application registry. */
interface ApplicationRegistry {
  /** Handles being booted or already running, keyed by application identity. */
  handles: Map<string, Promise<ApplicationHandle>>,
  /** Whether teardown has run; guards the idempotent stop and post-stop boots. */
  stopped: boolean,
}

/**
 * The process-wide registry, created on first use.
 * @returns The shared registry.
 */
function registry(): ApplicationRegistry {
  const scope = globalThis as unknown as Record<string, unknown>
  const existing = scope[REGISTRY_PROPERTY] as ApplicationRegistry | undefined
  if (existing) return existing

  const created: ApplicationRegistry = { handles: new Map(), stopped: false }
  scope[REGISTRY_PROPERTY] = created
  return created
}

/**
 * Boot one application for this test run.
 *
 * Every test file in the run shares the process-local handle; the testing
 * preload stops it at teardown, including after failures and `SIGINT`/`SIGTERM`.
 *
 * The identity is the **resolved** `(cwd, entry)` plus the environment and
 * development mode, so equivalent entry spellings address one application.
 * @param options - Startup options; `cwd` and `entry` identify the application.
 * @returns The shared application handle.
 * @throws {Error} When called after the process-local applications have been
 *   stopped, so a post-teardown caller cannot create a server the preload will
 *   not own.
 */
export async function useApplication(
  options: StartApplicationOptions,
): Promise<ApplicationHandle> {
  const { handles, stopped } = registry()
  if (stopped) {
    throw new Error(
      'useApplication cannot boot after the process-local applications were stopped',
    )
  }

  const cwd = resolvePath(options.cwd ?? process.cwd())
  const entry = resolvePath(cwd, options.entry)
  const identity = applicationIdentity(options, cwd, entry)
  const key = applicationIdentityKey(identity)
  const existing = handles.get(key)
  if (existing) return await existing

  const booting = startApplication({
    ...options,
    cwd,
    development: identity.development,
    entry,
  }).then(handle => {
    const stop = handle.stop
    handle.stop = async () => {
      const code = await stop()
      /*
       * A stopped handle must not satisfy a later useApplication call. Test
       * files commonly share one application identity and can stop it before
       * another file asks for it in the same process.
       */
      if (handles.get(key) === booting) handles.delete(key)
      return code
    }
    return handle
  })
  handles.set(key, booting)

  try {
    return await booting
  } catch (error) {
    handles.delete(key)
    throw error
  }
}

/**
 * Stop every process-local application. Idempotent, so normal end-of-run
 * teardown and interruption handlers cannot double-stop.
 */
export async function stopApplications(): Promise<void> {
  const scope = registry()
  if (scope.stopped) return
  scope.stopped = true

  const pending = [...scope.handles.values()]
  scope.handles.clear()
  await Promise.allSettled(pending.map(handle => handle.then(app => app.stop(), () => undefined)))
}
