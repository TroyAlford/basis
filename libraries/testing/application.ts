import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { homedir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
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
  /**
   * Reuse one development server per checkout between runs. `useApplication`
   * defaults to `true`; ephemeral lifecycle proofs set
   * `BASIS_APPLICATION_FIXTURE_EPHEMERAL=1`.
   */
  persistent?: boolean,
  /** HTTP path polled for readiness. Defaults to `/api/health`. */
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
  const {
    cwd = process.cwd(),
    development = false,
    entry,
    env = {},
    readyPath = '/api/health',
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
  /** Whether the server is persistent across runs. */
  readonly persistent: boolean,
}

/** A persisted application fixture lease. */
interface ApplicationLease {
  /** Process id of the development server. */
  readonly pid: number,
  /** Process start timestamp, for diagnosis. */
  readonly startedAt: string,
  /** Base URL of the development server. */
  readonly url: string,
}

/**
 * Resolve the persistent fixture directory for one application identity.
 * @param identity - Normalized application identity.
 * @returns The fixture directory.
 */
function applicationFixtureDirectory(identity: ApplicationIdentity): string {
  const configured = Bun.env.BASIS_APPLICATION_FIXTURE_ROOT
  const base = configured
    ? resolvePath(configured)
    : join(Bun.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'basis', 'test-app')
  const key = applicationIdentityKey(identity).slice(0, 16)
  const directory = join(base, key)
  mkdirSync(directory, { mode: 0o700, recursive: true })
  return directory
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
  const persistent = options.persistent ?? Bun.env.BASIS_APPLICATION_FIXTURE_EPHEMERAL !== '1'
  return {
    cwd,
    development: options.development ?? persistent,
    entry,
    env: options.env ?? {},
    persistent,
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

/**
 * Read a persisted application lease.
 * @param directory - Fixture directory.
 * @returns The lease, or undefined when absent/invalid.
 */
function readLease(directory: string): ApplicationLease | undefined {
  try {
    const value = JSON.parse(readFileSync(join(directory, 'lease.json'), 'utf8')) as Partial<ApplicationLease>
    if (
      typeof value.pid !== 'number'
      || typeof value.startedAt !== 'string'
      || typeof value.url !== 'string'
    ) {
      return undefined
    }
    return value as ApplicationLease
  } catch {
    return undefined
  }
}

/**
 * Atomically write one application lease.
 * @param directory - Fixture directory.
 * @param lease - Lease to persist.
 */
function writeLease(directory: string, lease: ApplicationLease): void {
  const temporary = join(directory, 'lease.tmp')
  writeFileSync(temporary, JSON.stringify(lease))
  renameSync(temporary, join(directory, 'lease.json'))
}

/**
 * Whether a process id is still alive.
 * @param pid - Process id.
 * @returns `true` when the process exists.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Stop one detached application process and wait briefly for exit.
 * @param pid - Process id.
 */
async function stopProcess(pid: number): Promise<void> {
  if (!isAlive(pid)) return
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!isAlive(pid)) return
    await Bun.sleep(50)
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The process exited between the liveness check and the signal.
  }
}

/**
 * Remove one persisted lease and stop its process.
 * @param directory - Fixture directory.
 * @param pid - Process id from the lease.
 */
async function stopLease(directory: string, pid: number): Promise<void> {
  await stopProcess(pid)
  rmSync(join(directory, 'lease.json'), { force: true })
}

/** Metadata written by the process that owns the lease lock. */
interface LeaseLockOwner {
  /** Owning process id. */
  readonly pid: number,
  /** Ownership start time in epoch milliseconds. */
  readonly startedAt: number,
}

/**
 * Read the owner metadata from one lease lock.
 * @param path - Lock file path.
 * @returns The owner, or undefined when the lock is malformed.
 */
function readLeaseLock(path: string): LeaseLockOwner | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LeaseLockOwner>
    if (typeof value.pid !== 'number' || typeof value.startedAt !== 'number') return undefined
    return value as LeaseLockOwner
  } catch {
    return undefined
  }
}

/**
 * Serialize persistent fixture startup for one application identity.
 * @param directory - Fixture directory.
 * @param timeoutMs - Readiness timeout of the owner being waited on.
 * @param work - Startup work.
 * @returns The work result.
 */
async function withLeaseLock<T>(
  directory: string,
  timeoutMs: number,
  work: () => Promise<T>,
): Promise<T> {
  const lock = join(directory, 'lease.lock')
  const staleAfter = timeoutMs + 30_000
  const deadline = Date.now() + staleAfter + 30_000
  while (true) {
    try {
      writeFileSync(lock, JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
      }), { flag: 'wx' })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owner = readLeaseLock(lock)
      let age = Number.POSITIVE_INFINITY
      try {
        age = Date.now() - statSync(lock).mtimeMs
      } catch {
        // A concurrent release won the race; retry immediately.
      }
      if (
        (!owner && age > 1_000)
        || (owner && !isAlive(owner.pid))
        || (owner && Date.now() - owner.startedAt > staleAfter)
      ) {
        rmSync(lock, { force: true })
        continue
      }
      if (Date.now() >= deadline) {
        throw new Error('Application fixture lease lock timed out', { cause: error })
      }
      await Bun.sleep(50)
    }
  }
  try {
    return await work()
  } finally {
    rmSync(lock, { force: true })
  }
}

/**
 * Check that a persisted application still owns a healthy server.
 * @param lease - Persisted lease.
 * @param readyPath - Readiness path.
 * @returns `true` when the process and readiness endpoint are alive.
 */
async function leaseHealthy(lease: ApplicationLease, readyPath: string): Promise<boolean> {
  if (!isAlive(lease.pid)) return false
  try {
    const status = await httpStatus(`${lease.url}${readyPath}`)
    return status >= 200 && status < 400
  } catch {
    return false
  }
}

/**
 * Attach to a persistent development server, or start one.
 * @param options - Startup options.
 * @param identity - Normalized application identity.
 * @returns The persistent application handle.
 */
async function usePersistentApplication(
  options: StartApplicationOptions,
  identity: ApplicationIdentity,
): Promise<ApplicationHandle> {
  const directory = applicationFixtureDirectory(identity)
  const readyPath = options.readyPath ?? '/api/health'
  const timeoutMs = options.timeoutMs ?? 30_000
  const temp = join(directory, 'tmp')
  mkdirSync(temp, { mode: 0o700, recursive: true })

  return await withLeaseLock(directory, timeoutMs, async () => {
    const lease = readLease(directory)
    if (lease && await leaseHealthy(lease, readyPath)) {
      return {
        stop: () => stopLease(directory, lease.pid),
        url: lease.url,
        visit: createVisit(lease.url),
      }
    }
    if (lease) {
      await stopLease(directory, lease.pid)
    }

    const port = await freePort()
    const url = `http://127.0.0.1:${port}`
    const proc = Bun.spawn([process.execPath, identity.entry], {
      cwd: identity.cwd,
      detached: true,
      env: {
        ...process.env,
        ...identity.env,
        HOST: '127.0.0.1',
        NODE_ENV: identity.env.NODE_ENV ?? (identity.development ? 'development' : 'production'),
        PORT: String(port),
        TEMP: identity.env.TEMP ?? temp,
        TMP: identity.env.TMP ?? temp,
        TMPDIR: identity.env.TMPDIR ?? temp,
      },
      stderr: 'ignore',
      stdin: 'ignore',
      stdout: 'ignore',
    })
    proc.unref()
    const next: ApplicationLease = {
      pid: proc.pid,
      startedAt: new Date().toISOString(),
      url,
    }
    writeLease(directory, next)

    try {
      await waitForReady(`${url}${readyPath}`, timeoutMs, () => '')
    } catch (error) {
      await stopLease(directory, proc.pid)
      throw error
    }

    return {
      stop: () => stopLease(directory, proc.pid),
      url,
      visit: createVisit(url),
    }
  })
}

/*
 * Persistent application fixture.
 *
 * `startApplication` is the low-level primitive: every call boots a dedicated
 * server. `useApplication` is the supported test entry point. It memoises one
 * handle per (cwd, entry) for the whole Bun test process and, by default,
 * persists one detached development server per application identity between
 * runs. The testing preload closes process-local handles, but leaves the
 * persistent server running so the next run can attach to its HMR process.
 *
 * Isolation contract: the browser side stays deterministic (`visit` opens a
 * fresh context with stubbed network and a per-visit `init`), while server-side
 * state is shared across runs. A test that needs a clean server must boot its
 * own through {@link startApplication} or use
 * `BASIS_APPLICATION_FIXTURE_EPHEMERAL=1`.
 */

/** The `globalThis` property that holds the process-wide application registry. */
const REGISTRY_PROPERTY = '__basisTestingApplications'

/** The process-local application registry. */
interface ApplicationRegistry {
  /** Handles being booted or already running, keyed by resolved working directory and entry. */
  handles: Map<string, Promise<ApplicationHandle>>,
  /** Keys whose handles are persistent and outlive this process. */
  persistent: Set<string>,
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

  const created: ApplicationRegistry = { handles: new Map(), persistent: new Set(), stopped: false }
  scope[REGISTRY_PROPERTY] = created
  return created
}

/**
 * Boot or attach to one application for this test process.
 *
 * By default, the server is a detached development process that stays alive
 * between runs and keeps HMR enabled. Every test file in a run shares the
 * process-local handle, and later runs attach to the same process. Set
 * `BASIS_APPLICATION_FIXTURE_EPHEMERAL=1` for a run-scoped server that the
 * testing preload stops.
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
  const { handles, persistent, stopped } = registry()
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

  const booting = identity.persistent
    ? usePersistentApplication(options, identity)
    : startApplication({ ...options, cwd, development: identity.development, entry })
  handles.set(key, booting)
  if (identity.persistent) persistent.add(key)

  try {
    return await booting
  } catch (error) {
    handles.delete(key)
    persistent.delete(key)
    throw error
  }
}

/** Options for process-local application teardown. */
export interface StopApplicationsOptions {
  /** Also stop persistent detached servers. Defaults to `false`. */
  readonly includePersistent?: boolean,
}

/**
 * Stop process-local applications. Idempotent, so a normal end-of-run teardown
 * and an interruption handler cannot double-stop.
 *
 * Persistent servers are left running by default so the next run can attach to
 * them. Pass `includePersistent` for an explicit cleanup.
 * @param options - Teardown options.
 */
export async function stopApplications(options: StopApplicationsOptions = {}): Promise<void> {
  const scope = registry()
  if (scope.stopped) return
  scope.stopped = true

  const keys = [...scope.handles.keys()].filter(key => (
    options.includePersistent || !scope.persistent.has(key)
  ))
  const pending = keys
    .map(key => scope.handles.get(key))
    .filter((handle): handle is Promise<ApplicationHandle> => Boolean(handle))
  for (const key of keys) {
    scope.handles.delete(key)
    scope.persistent.delete(key)
  }
  await Promise.allSettled(pending.map(handle => handle.then(app => app.stop(), () => undefined)))
}
