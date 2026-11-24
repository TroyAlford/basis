/** Health payload fields used by the production release monitor. */
export interface ReleaseHealth {
  /** Server readiness status. */
  status?: string,
  /** Authoritative release version. */
  version?: string,
}

/** Options for {@link startReleaseMonitor}. */
export interface ReleaseMonitorOptions {
  /** Timer canceller, injected by tests. */
  clear?: (timer: unknown) => void,
  /** Health request implementation. Defaults to same-origin `/api/health`. */
  health?: (signal: AbortSignal) => Promise<ReleaseHealth>,
  /** Version embedded in the document that is currently running. */
  loadedVersion: string,
  /** Maximum retry delay. Defaults to 5000 ms. */
  maxRetryMs?: number,
  /** Normal successful poll interval. Defaults to 5000 ms. */
  pollMs?: number,
  /** Reload implementation. Defaults to `window.location.reload()`. */
  reload?: () => void,
  /** Maximum time for one health request. Defaults to 5000 ms. */
  requestTimeoutMs?: number,
  /** First retry delay. Defaults to 250 ms. */
  retryBaseMs?: number,
  /** Timer scheduler, injected by tests. */
  schedule?: (callback: () => void, delay: number) => unknown,
}

/**
 * Watch the reachable server for a release-version change.
 *
 * A failed or non-ready health response retries with bounded exponential
 * backoff. A ready response with the same version resumes normal polling. A
 * different ready version reloads the document exactly once. The server's
 * `/api/health` version remains the only release authority.
 * @param options - Monitor configuration.
 * @returns A disposer that stops future checks.
 */
export function startReleaseMonitor(options: ReleaseMonitorOptions): () => void {
  const {
    clear = timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
    health = defaultHealth,
    loadedVersion,
    maxRetryMs = 5_000,
    pollMs = 5_000,
    reload = defaultReload,
    requestTimeoutMs = 5_000,
    retryBaseMs = 250,
    schedule = (callback, delay) => setTimeout(callback, delay),
  } = options

  let stopped = false
  let reloading = false
  let retries = 0
  let timer: unknown

  const retryDelay = (): number => {
    const delay = Math.min(maxRetryMs, retryBaseMs * (2 ** retries))
    retries += 1
    return delay
  }

  const next = (delay: number): void => {
    if (stopped || reloading) return
    timer = schedule(() => { void check() }, delay)
  }

  const check = async (): Promise<void> => {
    if (stopped || reloading) return
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const timedOut = new Promise<ReleaseHealth>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('health request timed out'))
        }, requestTimeoutMs)
      })
      const response = await Promise.race([health(controller.signal), timedOut])
      if (stopped || reloading) return
      if (response.status !== 'ok') {
        next(retryDelay())
        return
      }
      retries = 0
      if (response.version !== undefined && response.version !== loadedVersion) {
        reloading = true
        reload()
        return
      }
      next(pollMs)
    } catch {
      if (!stopped && !reloading) next(retryDelay())
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  next(pollMs)
  return () => {
    stopped = true
    if (timer !== undefined) clear(timer)
    timer = undefined
  }
}

/**
 * Fetch the same-origin readiness payload.
 * @param signal - Abort signal for the bounded request timeout.
 * @returns The parsed health payload.
 */
async function defaultHealth(signal: AbortSignal): Promise<ReleaseHealth> {
  const response = await fetch('/api/health', {
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  })
  if (!response.ok) return { status: response.status === 503 ? 'starting' : 'error' }
  return await response.json() as ReleaseHealth
}

/** Reload the current document. */
function defaultReload(): void {
  window.location.reload()
}
