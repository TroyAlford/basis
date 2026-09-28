import { get } from 'node:http'

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

/** A running application under test. */
export interface ApplicationHandle {
  /** Stop the application; idempotent. */
  stop: () => Promise<void>,
  /** The base URL of the running application. */
  url: string,
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
 * Boot the application's Basis server entry on an ephemeral loopback port.
 *
 * The entry is spawned as a child process (the same shape as a managed
 * deployment), so it can be the consumer's real server module. `HOST` and a
 * free `PORT` are injected; `NODE_ENV` defaults to `production` for
 * deterministic output and can be overridden through `env`.
 * @param options - Startup options.
 * @returns A handle with the base URL and an idempotent stop.
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

  return { stop, url }
}
