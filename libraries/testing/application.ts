import { get } from 'node:http'
import type { Page } from 'playwright'
import type { Viewport } from './browser'
import { withPage } from './browser'
import type { NetworkOptions } from './network'
import { installNetwork } from './network'

/** Options for {@link startApplication}. */
export interface StartApplicationOptions {
  /** Working directory for the server process. Defaults to `process.cwd()`. */
  cwd?: string,
  /** Path to the server entry module, relative to `cwd`. */
  entry: string,
  /** Extra environment for the server process. */
  env?: Record<string, string>,
  /** HTTP path polled for readiness. Defaults to `/health`. */
  readyPath?: string,
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
  /** Stop the application; idempotent. */
  stop: () => Promise<void>,
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
 */
async function waitForReady(url: string, timeoutMs: number, output: () => string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no response'

  while (Date.now() < deadline) {
    try {
      const status = await httpStatus(url)
      if (status >= 200 && status < 400) return
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
  const { cwd = process.cwd(), entry, env = {}, readyPath = '/health', timeoutMs = 30_000 } = options
  const port = await freePort()
  const proc = Bun.spawn([process.execPath, entry], {
    cwd,
    env: {
      ...process.env,
      ...env,
      HOST: '127.0.0.1',
      NODE_ENV: env.NODE_ENV ?? 'production',
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
  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    proc.kill()
    await proc.exited
  }

  try {
    await waitForReady(`${url}${readyPath}`, timeoutMs, () => output)
  } catch (error) {
    await stop()
    throw error
  }

  const visit = async <T>(
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

  return { stop, url, visit }
}

/*
 * Run-scoped fixture.
 *
 * `startApplication` is the low-level primitive: every call boots a server.
 * `useApplication` is the supported test entry point. It memoises one handle per
 * (cwd, entry) for the whole Bun test process — the registry lives on
 * `globalThis`, which survives Bun's per-file module registry — so the first
 * caller boots and every later caller, concurrent or not, awaits the same
 * promise. Teardown is registered once by the testing preload
 * (`libraries/testing/bun.ts`), so no test file needs `afterAll` or `finally`.
 *
 * Isolation contract: the browser side stays deterministic (`visit` opens a
 * fresh context with stubbed network and a per-visit `init`), but server-side
 * state is shared across the run. A test that needs a clean server must boot its
 * own through {@link startApplication}.
 */

/** The `globalThis` property that holds the process-wide application registry. */
const REGISTRY_PROPERTY = '__basisTestingApplications'

/** The process-wide run-scoped application registry. */
interface ApplicationRegistry {
  /** Handles being booted or already running, keyed by working directory and entry. */
  handles: Map<string, Promise<ApplicationHandle>>,
  /** Whether teardown has run; guards the idempotent stop. */
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
 * Boot the application once for the whole test run, or return the handle the
 * first caller booted.
 *
 * Use this in tests instead of {@link startApplication}: every file in the run
 * shares one server, which the testing preload stops once when the run ends.
 * {@link startApplication} remains available when a test needs a dedicated
 * server of its own.
 * @param options - Startup options; `cwd` and `entry` identify the application.
 * @returns The shared application handle.
 */
export async function useApplication(
  options: StartApplicationOptions,
): Promise<ApplicationHandle> {
  const { handles } = registry()
  const key = `${options.cwd ?? process.cwd()}\u0000${options.entry}`
  const existing = handles.get(key)
  if (existing) return await existing

  const booting = startApplication(options)
  handles.set(key, booting)

  try {
    return await booting
  } catch (error) {
    handles.delete(key)
    throw error
  }
}

/**
 * Stop every run-scoped application. Idempotent, so a normal end-of-run
 * teardown and an interruption handler cannot double-stop.
 */
export async function stopApplications(): Promise<void> {
  const { handles, stopped } = registry()
  if (stopped) return
  registry().stopped = true

  const pending = [...handles.values()]
  handles.clear()
  await Promise.allSettled(pending.map(handle => handle.then(app => app.stop(), () => undefined)))
}
