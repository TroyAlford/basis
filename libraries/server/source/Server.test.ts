import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { join } from 'node:path'
import type { ILogger } from '../../utilities'
import { Logger } from '../../utilities'
import { Builder } from './Builder'
import { Server } from './Server'

/*
 * The happy-dom test preload replaces `globalThis.fetch` with a browser fetch
 * that blocks cross-origin requests, so the fixtures are probed with Bun's
 * native `Bun.fetch`.
 */

/** A running server fixture. */
interface ServerHarness {
  /** The port the fixture bound. */
  port: number,
  /** Sends SIGTERM and resolves with the child's exit code. */
  stop: () => Promise<number>,
}

/** The subset of the health payload the tests inspect. */
interface HealthBody {
  /** Present when the build/readiness failed. */
  error?: string,
  /** The application readiness. */
  status?: string,
  /** The release version. */
  version?: string,
}

const repoRoot = join(import.meta.dir, '..', '..', '..')
const fixtureRoot = join(repoRoot, 'testing', 'server')
const fixture = join(fixtureRoot, 'index.ts')
const active = new Set<ServerHarness>()

/**
 * Spawns the managed-application fixture and waits for its listening line.
 * @param mode The server mode to run the fixture in.
 * @param extraEnv Additional environment for the child.
 * @returns A harness exposing the bound port and an idempotent stop.
 */
const startServer = async (
  mode: 'development' | 'production',
  extraEnv: Record<string, string> = {},
): Promise<ServerHarness> => {
  const proc = Bun.spawn([process.execPath, fixture], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      MODE: mode,
      PORT: '0',
      VERSION: 'test-version',
      ...extraEnv,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })

  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let output = ''
  let port: number | null = null
  const deadline = Date.now() + 30_000

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
    throw new Error(`server fixture did not start (${mode}):\n${output}\n${stderr}`)
  }

  // Keep draining stdout so the child never blocks on a full pipe.
  void (async () => {
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
  })()

  let exit: Promise<number> | null = null
  const harness: ServerHarness = {
    port,
    stop: async () => {
      if (exit) return exit
      proc.kill('SIGTERM')
      exit = proc.exited
      return exit
    },
  }

  active.add(harness)
  return harness
}

/**
 * Polls `/health` until it satisfies the predicate.
 * @param base The server origin.
 * @param predicate The condition the health response must satisfy.
 * @returns The matching response and parsed body.
 */
const waitForHealth = async (
  base: string,
  predicate: (response: Response, body: HealthBody) => boolean,
): Promise<{ body: HealthBody, response: Response }> => {
  const deadline = Date.now() + 30_000
  let last: { body: HealthBody, response: Response } | null = null

  while (Date.now() < deadline) {
    const response = await Bun.fetch(`${base}/health`)
    const body = await response.json() as HealthBody
    last = { body, response }
    if (predicate(response, body)) return last
    await Bun.sleep(50)
  }

  throw new Error(`health never reached the expected state: ${JSON.stringify(last?.body)}`)
}

afterEach(async () => {
  for (const harness of active) {
    await harness.stop()
    active.delete(harness)
  }
})

describe('Server production mode', () => {
  test('serves the managed app, health, and assets without development machinery', async () => {
    const server = await startServer('production')
    const base = `http://127.0.0.1:${server.port}`

    // Health only turns ok once the initial production build succeeded.
    const { body, response } = await waitForHealth(base, (result, payload) => (
      result.status === 200 && payload.status === 'ok'
    ))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(body).toMatchObject({ status: 'ok', version: 'test-version' })

    // The endpoint stays reachable under its namespaced route too.
    const namespaced = await Bun.fetch(`${base}/api/health`)
    expect(namespaced.status).toBe(200)
    expect(await namespaced.json()).toMatchObject({ status: 'ok', version: 'test-version' })

    const ui = await Bun.fetch(base)
    const html = await ui.text()
    expect(ui.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('/scripts/index.js')
    expect(html).not.toContain('hmr.js')
    expect(html).not.toContain('/modules/')

    // Unmatched paths fall back to the SPA shell.
    const spa = await Bun.fetch(`${base}/decks/123`)
    expect(spa.status).toBe(200)
    expect(await spa.text()).toContain('/scripts/index.js')

    const script = await Bun.fetch(`${base}/scripts/index.js`)
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toContain('javascript')

    /*
     * The shell loads entrypoints as classic `<script defer>` tags, and
     * `Application.tsx` exports a binding. The served bundle must therefore be
     * classic-script compatible: no top-level ESM statements, and it must
     * compile as a script (an IIFE; issue #154).
     */
    const scriptCode = await script.text()
    expect(scriptCode).toContain('Basis managed server')
    expect(scriptCode).not.toMatch(/^\s*(?:export|import)\b/m)
    expect(() => new Function(scriptCode)).not.toThrow()

    expect((await Bun.fetch(`${base}/assets/favicon.svg`)).status).toBe(200)

    // The development CDN proxy is not part of the production path.
    expect((await Bun.fetch(`${base}/modules/react@19.3.0/umd/react.development.js`)).status).toBe(404)

    expect(await server.stop()).toBe(0)
  })

  test('serves bundler-emitted assets referenced by the bundle', async () => {
    const server = await startServer('production', { ENTRY: './WithAsset.tsx' })
    const base = `http://127.0.0.1:${server.port}`

    await waitForHealth(base, (result, payload) => result.status === 200 && payload.status === 'ok')

    /*
     * The bundle references its emitted asset by an absolute `/scripts/...` URL
     * (Builder's `publicPath`); that same route must serve the bytes (issue #155).
     */
    const code = await Bun.fetch(`${base}/scripts/index.js`).then(response => response.text())
    const assetUrl = code.match(/\/scripts\/[A-Za-z0-9._-]+\.png/)?.[0]
    if (!assetUrl) throw new Error('the bundle did not reference an emitted asset')

    const asset = await Bun.fetch(`${base}${assetUrl}`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('image/png')
    expect(new Uint8Array(await asset.arrayBuffer())).toEqual(
      new Uint8Array(await Bun.file(join(fixtureRoot, 'pixel.png')).arrayBuffer()),
    )

    expect(await server.stop()).toBe(0)
  })

  test('never reports healthy when the initial build fails', async () => {
    const server = await startServer('production', { ENTRY: './Broken.tsx' })
    const base = `http://127.0.0.1:${server.port}`

    const { body, response } = await waitForHealth(base, (result, payload) => (
      result.status === 503 && payload.status === 'error'
    ))
    expect(response.status).toBe(503)
    expect(body).toMatchObject({ status: 'error', version: 'test-version' })
    expect(body.error).toBeTruthy()

    // A failed build serves no entrypoint.
    expect((await Bun.fetch(`${base}/scripts/index.js`)).status).toBe(404)

    expect(await server.stop()).toBe(0)
  })
})

describe('Server development mode', () => {
  test('keeps live-build, HMR, and bundled dependencies (no CDN)', async () => {
    const server = await startServer('development')
    const base = `http://127.0.0.1:${server.port}`

    await waitForHealth(base, (result, payload) => result.status === 200 && payload.status === 'ok')

    const html = await Bun.fetch(base).then(response => response.text())
    expect(html).not.toContain('/modules/')
    expect(html).toContain('/scripts/hmr.js')
    expect(html).toContain('/scripts/index.js')

    expect((await Bun.fetch(`${base}/scripts/index.js`)).status).toBe(200)
    expect((await Bun.fetch(`${base}/scripts/hmr.js`)).status).toBe(200)
  })
})

describe('Server SSE idle streams', () => {
  test('opts every SSE response out of the HTTP idle timeout per request', async () => {
    class RecordingServer extends Server {
      readonly keepAlives: number[] = []
      protected override keepSseStreamAlive(request: Request): void {
        this.keepAlives.push(0)
        super.keepSseStreamAlive(request)
      }
    }

    const server = new RecordingServer()
    server.sse('events', (_params, _context, channel) => {
      channel.send('ready', {})
    })

    /*
     * Drive the router directly; this asserts the SSE path opts out and that a
     * non-SSE path does not, independent of the Bun runtime's timeout behavior.
     */
    await server.handle(new Request('http://localhost/events'))
    expect(server.keepAlives).toEqual([0])

    await server.handle(new Request('http://localhost/health'))
    expect(server.keepAlives).toEqual([0])
  })

  test('delivers a later event on a stream idle past the server idle timeout', async () => {
    /*
     * Integration/compatibility test: verifies the final behavior on a runtime
     * that enforces idleTimeout. On Bun 1.4.2 a quiet ReadableStream response is
     * not closed by idleTimeout, so this does not by itself demonstrate the
     * timeout contract; the per-request opt-out test above does.
     */
    const server = await startServer('production', { IDLE_TIMEOUT: '1' })
    const base = `http://127.0.0.1:${server.port}`
    await waitForHealth(base, (result, payload) => result.status === 200 && payload.status === 'ok')

    const response = await Bun.fetch(`${base}/idle`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const readUntil = async (needle: string): Promise<boolean> => {
      const deadline = Date.now() + 5_000
      while (!text.includes(needle) && Date.now() < deadline) {
        const { done, value } = await reader?.read() ?? { done: true, value: undefined }
        if (done) break
        if (value) text += decoder.decode(value)
      }
      return text.includes(needle)
    }

    expect(await readUntil('"event":"ready"')).toBe(true)
    // The stream is idle from 0s to 2.5s while the server idleTimeout is 1s.
    expect(await readUntil('"event":"pong"')).toBe(true)

    await reader?.cancel()
    expect(await server.stop()).toBe(0)
  }, 15_000)
})

describe('Server readiness', () => {
  test('ready resolves once the initial build succeeds', async () => {
    const server = new Server()
      .root(fixtureRoot)
      .main('./Application.tsx')
      .start({ development: false, hostname: '127.0.0.1', port: 0, version: 'test-version' })

    try {
      await expect(server.ready()).resolves.toBeUndefined()
    } finally {
      server.stop()
    }
  })

  test('ready rejects when the initial build fails', async () => {
    const server = new Server()
      .root(fixtureRoot)
      .main('./Broken.tsx')
      .start({ development: false, hostname: '127.0.0.1', port: 0, version: 'test-version' })

    try {
      await expect(server.ready()).rejects.toThrow()
    } finally {
      server.stop()
    }
  })
})

describe('Builder', () => {
  test('does not establish a watcher when watching is disabled', async () => {
    const builder = new Builder({ development: false, root: fixtureRoot, watch: false })
    await builder.add('index.js', './Application.tsx')

    const outputs = await builder.initialBuild()
    expect(builder.watching).toBe(false)
    /*
     * `index.js` is the logical route name; the run also emits a sourcemap, so
     * assert the entrypoint is present rather than a total count.
     */
    expect(outputs.map(output => output.name)).toContain('index.js')

    await builder.stop()
  })

  test('establishes a watcher in development', async () => {
    const builder = new Builder({ development: true, root: fixtureRoot, watch: true })
    await builder.add('index.js', './Application.tsx')
    await builder.initialBuild()

    expect(builder.watching).toBe(true)

    await builder.stop()
    expect(builder.watching).toBe(false)
  })
})

/**
 * Build a logger that records every message instead of writing to the console.
 * @returns The recording logger and the messages it captured.
 */
function createRecordingLogger(): { readonly logger: ILogger, readonly messages: string[] } {
  const messages: string[] = []
  const logger: ILogger = {
    error: (...values: string[]) => { messages.push(`error ${values.join(' ')}`) },
    info: (...values: string[]) => { messages.push(`info ${values.join(' ')}`) },
    stopwatchSplit: () => 0,
    stopwatchStart: () => Symbol('stopwatch'),
    stopwatchStop: () => 0,
    warn: (...values: string[]) => { messages.push(`warn ${values.join(' ')}`) },
  }
  return { logger, messages }
}

/**
 * Restore environment variables that a test overwrote.
 * @param previous - The values captured before the test ran.
 */
function restoreEnv(previous: Readonly<Record<string, string | undefined>>): void {
  for (const key of Object.keys(previous)) {
    const value = previous[key]
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
}

describe('Server logging', () => {
  test('constructs a standard Basis Logger and exposes it', () => {
    const server = new Server()

    expect(server.logger).toBeInstanceOf(Logger)
  })

  test('routes startup and shutdown through the injected logger', () => {
    const { logger, messages } = createRecordingLogger()
    const server = new Server()
      .root(fixtureRoot)
      .main('./Application.tsx')
      .start({ development: false, hostname: '127.0.0.1', logger, port: 0, version: 'test-version' })

    try {
      expect(messages.some(message => message.includes('listening http://'))).toBe(true)
    } finally {
      server.stop()
    }

    expect(messages.some(message => message.includes('stopping'))).toBe(true)
  })

  test('does not write lifecycle output through raw console when a logger is injected', () => {
    const { logger } = createRecordingLogger()
    const logged = spyOn(console, 'log').mockImplementation(() => undefined)
    const server = new Server()
      .root(fixtureRoot)
      .main('./Application.tsx')
      .start({ development: false, hostname: '127.0.0.1', logger, port: 0, version: 'test-version' })

    try {
      expect(logged).not.toHaveBeenCalled()
    } finally {
      server.stop()
      logged.mockRestore()
    }
  })

  test('attaches SERVICE_NAME, VERSION, and GIT_SHA to the default logger', () => {
    const previous = {
      GIT_SHA: process.env.GIT_SHA,
      SERVICE_NAME: process.env.SERVICE_NAME,
      VERSION: process.env.VERSION,
    }
    process.env.SERVICE_NAME = 'mtg-proxifier'
    process.env.VERSION = '1.2.3'
    process.env.GIT_SHA = 'abc123'

    const captures: string[] = []
    const logged = spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
      captures.push(values.map(String).join(' '))
    })

    try {
      const server = new Server()
      server.logger.info('hello')

      expect(captures.join('\n')).toContain('[mtg-proxifier 1.2.3 abc123]')
    } finally {
      logged.mockRestore()
      restoreEnv(previous)
    }
  })
})

describe('Server WebSocket routes', () => {
  test('accepts upgrades on a registered route, including the internal HMR route', async () => {
    const server = await startServer('production')

    /*
     * Connect from a native child process: the happy-dom test preload replaces
     * `WebSocket` with a browser stand-in that does not perform a real upgrade.
     */
    const script = [
      `const ws = new WebSocket('ws://127.0.0.1:${server.port}/hmr')`,
      "ws.onopen = () => { console.log('connected'); ws.close(); process.exit(0) }",
      "ws.onerror = () => { console.log('failed'); process.exit(1) }",
      "setTimeout(() => { console.log('timeout'); process.exit(2) }, 5000)",
    ].join('\n')

    const proc = Bun.spawn([process.execPath, '-e', script], { stderr: 'pipe', stdout: 'pipe' })
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited

    expect(stdout).toContain('connected')
    expect(code).toBe(0)

    expect(await server.stop()).toBe(0)
  })
})
