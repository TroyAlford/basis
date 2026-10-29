import { afterEach, describe, expect, test } from 'bun:test'

/** A running docs-server fixture. */
interface DocsServer {
  /** The port the server bound. */
  port: number,
  /** Stops the process and resolves with its exit code. */
  stop: () => Promise<number>,
}

const active = new Set<DocsServer>()

/**
 * Spawns the repository's real docs entrypoint and waits for its listening line.
 * @returns A harness exposing the bound port and an idempotent stop.
 */
const startDocsServer = async (): Promise<DocsServer> => {
  const proc = Bun.spawn([process.execPath, 'server.ts'], {
    cwd: import.meta.dir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      PORT: '0',
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })

  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let output = ''
  let port: number | null = null
  const deadline = Date.now() + 60_000

  while (port === null && Date.now() < deadline) {
    const { done, value } = await reader.read()
    if (done) break
    output += decoder.decode(value)
    const match = output.match(/listening http:\/\/[^:]+:(\d+)/)
    if (match) port = Number(match[1])
  }

  if (port === null) {
    proc.kill()
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`docs server did not start:\n${output}\n${stderr}`)
  }

  // Keep draining stdout so the child never blocks on a full pipe.
  void (async () => {
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
  })()

  let exit: Promise<number> | null = null
  const server: DocsServer = {
    port,
    stop: async () => {
      if (exit) return exit
      proc.kill('SIGTERM')
      exit = proc.exited
      return exit
    },
  }

  active.add(server)
  return server
}

/** The subset of the health payload the test inspects. */
interface HealthBody {
  /** Present when the development build failed. */
  error?: string,
  /** The application readiness. */
  status?: string,
}

/**
 * Polls `/api/health` until the docs application reports ready.
 * @param base - The server origin.
 * @returns The ready health payload.
 */
const waitForReady = async (base: string): Promise<HealthBody> => {
  const deadline = Date.now() + 60_000
  let last: HealthBody | null = null

  while (Date.now() < deadline) {
    const response = await Bun.fetch(`${base}/api/health`)
    const body = await response.json() as HealthBody
    last = body
    if (response.status === 200 && body.status === 'ok') return body
    await Bun.sleep(50)
  }

  throw new Error(`docs application never became ready: ${JSON.stringify(last)}`)
}

afterEach(async () => {
  for (const server of active) {
    await server.stop()
    active.delete(server)
  }
})

describe('docs server entrypoint', () => {
  test('starts from the repository root and serves the docs site', async () => {
    const server = await startDocsServer()
    const base = `http://127.0.0.1:${server.port}`

    await waitForReady(base)

    const response = await Bun.fetch(base)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('<div id="root"></div>')

    expect(await server.stop()).toBe(0)
  }, 90_000)
})
