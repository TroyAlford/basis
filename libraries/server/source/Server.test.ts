import { startApplication, tempDirectory } from 'basis/testing'
import { runAsync } from 'basis/utilities'
import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test'
import { existsSync, symlinkSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ILogger } from '../../utilities'
import { HttpVerb, Logger } from '../../utilities'
import { Builder } from './Builder'
import { Graph } from './Graph'
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

setDefaultTimeout(20_000)

const repoRoot = join(import.meta.dir, '..', '..', '..')
const basisLink = join(repoRoot, 'node_modules', 'basis')
if (!existsSync(basisLink)) symlinkSync(repoRoot, basisLink, 'dir')
const fixtureRoot = join(repoRoot, 'testing', 'server')
const fixture = join(fixtureRoot, 'serve.ts')
const active = new Set<ServerHarness>()

/**
 * Starts the managed-application fixture through the Basis application fixture.
 * @param extraEnv Additional environment for the child.
 * @param entry The fixture entrypoint module to start.
 * @returns A harness exposing the bound port and an idempotent stop.
 */
const startServer = async (
  extraEnv: Record<string, string> = {},
  entry: string = fixture,
): Promise<ServerHarness> => {
  if (extraEnv.ROOT) {
    const root = extraEnv.ROOT
    if (!existsSync(join(root, 'node_modules'))) {
      symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
    }
  }
  const application = await startApplication({
    cwd: repoRoot,
    entry,
    env: { VERSION: 'test-version', ...extraEnv },
    readyPath: '/api/health',
    readyStatus: status => status === 200 || status === 503,
  })
  const harness: ServerHarness = {
    port: Number(new URL(application.url).port),
    stop: application.stop,
  }

  active.add(harness)
  return harness
}

/**
 * Polls `/api/health` until it satisfies the predicate.
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
    const response = await Bun.fetch(`${base}/api/health`)
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

describe('Server', () => {
  test('serves the app through Bun dev-server HMR with runtime facts and no reload shim', async () => {
    const server = await startServer()
    const base = `http://127.0.0.1:${server.port}`

    await waitForHealth(base, (result, payload) => result.status === 200 && payload.status === 'ok')

    const html = await Bun.fetch(base).then(response => response.text())

    /*
     * Development delegates to Bun's dev server: the shell carries Bun's HMR
     * client (served under `/_bun/`) and never the full-page-reload shim Basis
     * used to ship as `hmr.js`.
     */
    expect(html).toContain('/_bun/')
    expect(html).not.toContain('/scripts/hmr.js')

    // The shell carries runtime facts, the SSR payload, and the hydrated root.
    expect(html).toContain('id="basis-runtime"')
    expect(html).toContain('id="basis-bootstrap"')
    expect(html).toContain('id="root"')
    expect(html).toContain('Basis managed server')
    expect(html).toContain('<title>Basis &lt;fixture&gt;</title>')

    // Unmatched paths fall back to the same HMR-enabled SPA shell.
    const deep = await Bun.fetch(`${base}/decks/123`)
    expect(deep.status).toBe(200)
    expect(await deep.text()).toContain('/_bun/')

    // Development never reaches the CDN module proxy.
    expect(html).not.toContain('/modules/')

    expect(await server.stop()).toBe(0)
  })

  test('loads request context for SSR and API handlers', async () => {
    const server = new Server()
      .root(fixtureRoot)
      .main('./ContextApplication.tsx')
      .context(async () => ({ context: { greeting: 'hello from context' } }))
      .api([HttpVerb.Get], 'context', (_params, context) => new Response(context.context.greeting))
      .start({ hostname: '127.0.0.1', port: 0 })

    try {
      await server.ready()
      const base = `http://127.0.0.1:${server.port}`

      const html = await Bun.fetch(base).then(response => response.text())
      expect(html).toContain('hello from context')
      expect(html).toContain('id="basis-bootstrap"')

      const api = await server.handle(new Request(`${base}/api/context`))
      expect(await api?.text()).toBe('hello from context')
    } finally {
      server.stop()
    }
  })

  test('keeps health independent of a failing application context loader', async () => {
    let loads = 0
    const server = new Server().context(async () => {
      loads += 1
      throw new Error('application dependency unavailable')
    })

    const response = await server.handle(new Request('http://localhost/api/health'))

    expect(response?.status).toBe(503)
    expect(await response?.json()).toMatchObject({ status: 'starting' })
    expect(loads).toBe(0)
  })

  test('does not load context for unmatched API routes', async () => {
    let loads = 0
    const server = new Server().context(async () => {
      loads += 1
      return { context: {} }
    })

    const response = await server.handle(new Request('http://localhost/api/missing'))

    expect(response?.status).toBe(400)
    expect(loads).toBe(0)
  })

  test('rejects an application context returned without the result wrapper', async () => {
    const server = new Server()
      .context((() => ({ greeting: 'hello' })) as never)
      .api([HttpVerb.Get], 'context', (_params, context) => Response.json(context.context))

    await expect(server.handle(new Request('http://localhost/api/context')))
      .rejects.toThrow('Basis: a context loader must return { context }')
  })

  test('applies context headers and cookies to SSE responses', async () => {
    const server = new Server()
      .context(async ({ cookies }) => ({
        context: {},
        cookies: cookies.set('stream', 'context-value', { path: '/' }),
        headers: { 'X-Context-Stream': 'applied' },
      }))
      .sse('events', (_params, _context, channel) => {
        channel.send('ready', {})
      })

    const response = await server.handle(new Request('http://localhost/events'))

    expect(response?.headers.get('x-context-stream')).toBe('applied')
    expect(response?.headers.get('set-cookie')).toContain('stream=context-value')
    await response?.body?.cancel()
  })

  test('applies context headers and cookies to SSR and API responses', async () => {
    const server = new Server()
      .root(fixtureRoot)
      .main('./ContextApplication.tsx')
      .context(async ({ cookies }) => ({
        context: { greeting: cookies.get('seen') ?? 'missing' },
        cookies: [cookies.set('theme', 'dark', { path: '/' })],
        headers: { 'X-Context': 'applied' },
      }))
      .api([HttpVerb.Get], 'context', (_params, context) => Response.json(context.context))
      .start({ hostname: '127.0.0.1', port: 0 })

    try {
      await server.ready()
      const base = `http://127.0.0.1:${server.port}`
      const response = await Bun.fetch(base, { headers: { cookie: 'seen=request-value' } })

      expect(await response.text()).toContain('request-value')
      expect(response.headers.get('x-context')).toBe('applied')
      expect(response.headers.get('set-cookie')).toContain('theme=dark')

      const api = await server.handle(new Request(`${base}/api/context`, {
        headers: new Headers({ cookie: 'seen=request-value' }),
      }))
      expect(await api?.json()).toEqual({ greeting: 'missing' })
      expect(api?.headers.get('x-context')).toBe('applied')
      expect(api?.headers.get('set-cookie')).toContain('theme=dark')
    } finally {
      await server.shutdown()
    }
  })

  test('never reports healthy when a development build fails', async () => {
    const server = await startServer({ ENTRY: './Broken.tsx' })
    const base = `http://127.0.0.1:${server.port}`

    const { body, response } = await waitForHealth(base, (result, payload) => (
      result.status === 503 && payload.status === 'error'
    ))
    expect(response.status).toBe(503)
    expect(body).toMatchObject({ status: 'error' })

    expect(await server.stop()).toBe(0)
  })
})

describe('Server-side HMR', () => {
  test('rebuilds SSR markup when the main module or an imported dependency changes', async () => {
    const dir = tempDirectory('basis-ssr-hmr')
    const main = join(dir, 'Application.tsx')
    const dependency = join(dir, 'value.ts')

    try {
      symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir')
      await Bun.write(dependency, "export const value = 'first'\n")
      await Bun.write(
        main,
        `import * as React from 'react'
import { value } from './value'
export const Application = () => React.createElement('main', null, value)
`,
      )

      const server = new Server()
        .root(dir)
        .main('./Application.tsx')
        .start({ hostname: '127.0.0.1', port: 0 })

      try {
        await server.ready()
        await Bun.sleep(250)
        const base = `http://127.0.0.1:${server.port}`

        expect(await Bun.fetch(base).then(response => response.text())).toContain('first')

        await writeFile(dependency, "export const value = 'second'\n")

        const deadline = Date.now() + 4_000
        let html = ''
        while (Date.now() < deadline) {
          html = await Bun.fetch(base).then(response => response.text())
          if (html.includes('second')) break
          await Bun.sleep(50)
        }

        expect(html).toContain('second')
        expect(html).not.toContain('first')
      } finally {
        await server.shutdown()
      }
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  })
})

test('coalesces concurrent SSR builds and never installs a stale version', async () => {
  const dir = tempDirectory('basis-ssr-race')
  const dependency = join(dir, 'value.ts')
  const originalBuild = Bun.build
  let delay = 0
  const buildSpy = spyOn(Bun, 'build').mockImplementation(async (...args) => {
    if (delay > 0) await Bun.sleep(delay)
    return originalBuild(...args)
  })

  try {
    symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir')
    await Bun.write(dependency, "export const value = 'initial'\n")
    await Bun.write(
      join(dir, 'Application.tsx'),
      `import * as React from 'react'
import { value } from './value'
export const Application = () => React.createElement('main', null, value)
`,
    )

    delay = 100
    const server = new Server()
      .root(dir)
      .main('./Application.tsx')
      .start({ hostname: '127.0.0.1', port: 0 })

    try {
      await server.ready()
      await Bun.write(dependency, "export const value = 'second'\n")

      const base = `http://127.0.0.1:${server.port}`
      const requests = Array.from({ length: 6 }, () => Bun.fetch(base).then(response => response.text()))
      await Bun.sleep(20)
      await Bun.write(dependency, "export const value = 'third'\n")
      requests.push(Bun.fetch(base).then(response => response.text()))

      const responses = await Promise.all(requests)
      for (const html of responses) {
        expect(html).toContain('<main>')
        expect(html).not.toContain('missing-module')
      }

      const deadline = Date.now() + 4_000
      let latest = ''
      while (Date.now() < deadline) {
        latest = await Bun.fetch(base).then(response => response.text())
        if (latest.includes('<main>third</main>')) break
        await Bun.sleep(50)
      }
      expect(latest).toContain('<main>third</main>')
    } finally {
      await server.shutdown()
    }
  } finally {
    buildSpy.mockRestore()
    await rm(dir, { force: true, recursive: true })
  }
}, 30_000)

test('cleans obsolete SSR artifacts and removes its scope on shutdown', async () => {
  const dir = tempDirectory('basis-ssr-cleanup')
  const dependency = join(dir, 'value.ts')
  try {
    symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir')
    await Bun.write(dependency, "export const value = 'one'\n")
    await Bun.write(
      join(dir, 'Application.tsx'),
      `import * as React from 'react'
import { value } from './value'
export const Application = () => React.createElement('main', null, value)
`,
    )
    const server = new Server().root(dir).main('./Application.tsx').start({ hostname: '127.0.0.1', port: 0 })
    try {
      await server.ready()
      const base = `http://127.0.0.1:${server.port}`
      for (const value of ['two', 'three']) {
        await Bun.write(dependency, `export const value = '${value}'\n`)
        const deadline = Date.now() + 5_000
        while (Date.now() < deadline) {
          if ((await Bun.fetch(base).then(response => response.text())).includes(value)) break
          await Bun.sleep(50)
        }
      }

      const ssrRoot = join(dir, '.basis', 'ssr')
      const scopes = (await import('node:fs')).readdirSync(ssrRoot)
      expect(scopes).toHaveLength(1)
      const versions = (await import('node:fs')).readdirSync(join(ssrRoot, scopes[0]))
      expect(versions).toHaveLength(1)
    } finally {
      await server.shutdown()
    }
    const leftover = (await import('node:fs')).existsSync(join(dir, '.basis', 'ssr'))
      ? (await import('node:fs')).readdirSync(join(dir, '.basis', 'ssr'))
      : []
    expect(leftover).toEqual([])
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}, 30_000)

test('recovers when a superseded SSR build fails', async () => {
  const dir = tempDirectory('basis-ssr-superseded-failure')
  const dependency = join(dir, 'value.ts')
  const originalBuild = Bun.build
  let calls = 0
  const buildSpy = spyOn(Bun, 'build').mockImplementation(async (...args) => {
    const entrypoint = String((args[0] as { entrypoints?: string[] }).entrypoints?.[0] ?? '')
    if (entrypoint.endsWith('Application.tsx')) calls += 1
    if (calls === 2 && entrypoint.endsWith('Application.tsx')) {
      await Bun.sleep(2_000)
      return { logs: [{ message: 'forced failure' }], success: false } as Awaited<ReturnType<typeof Bun.build>>
    }
    return originalBuild(...args)
  })
  try {
    symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'dir')
    await Bun.write(dependency, "export const value = 'initial'\n")
    await Bun.write(
      join(dir, 'Application.tsx'),
      `import * as React from 'react'
import { value } from './value'
export const Application = () => React.createElement('main', null, value)
`,
    )
    const server = new Server().root(dir).main('./Application.tsx').start({ hostname: '127.0.0.1', port: 0 })
    try {
      await server.ready()
      const base = `http://127.0.0.1:${server.port}`
      await Bun.write(dependency, "export const value = 'second'\n")
      await Bun.sleep(200)
      const first = Bun.fetch(base).then(response => response.text())
      await Bun.sleep(20)
      await Bun.write(dependency, "export const value = 'third'\n")
      await Bun.sleep(1_000)
      const html = await first

      expect(html).toContain('<main>third</main>')
    } finally {
      await server.shutdown()
    }
  } finally {
    buildSpy.mockRestore()
    await rm(dir, { force: true, recursive: true })
  }
}, 30_000)

describe('Server development HMR', () => {
  test('delivers a hot update over the HMR socket when a source file changes', async () => {
    const dir = tempDirectory('basis-hmr')

    try {
      const valueFile = join(dir, 'value.ts')
      await Bun.write(valueFile, "export const value = 'one'\n")
      await Bun.write(
        join(dir, 'entry.ts'),
        `import { value } from './value'
;(globalThis as { __value?: string }).__value = value
export const Application = () => null
`,
      )

      const server = await startServer({ ENTRY: join(dir, 'entry.ts') })
      const base = `http://127.0.0.1:${server.port}`
      await waitForHealth(base, (result, payload) => result.status === 200 && payload.status === 'ok')

      /*
       * Touch the shell once so Bun traces the entrypoint and its import into
       * the module graph; an edit before that would not be watched. A healthy
       * shell proves the build succeeded, not that we are observing a build
       * error frame.
       */
      const shell = await Bun.fetch(base).then(response => response.text())
      expect(shell).not.toContain('Build Failed')

      const script = `
const fs = require('node:fs')
const ws = new WebSocket('ws://127.0.0.1:${server.port}/_bun/hmr')
ws.binaryType = 'arraybuffer'
ws.onopen = () => {
  console.log('OPEN')
  setTimeout(() => fs.writeFileSync(${JSON.stringify(valueFile)}, "export const value = 'two'\\n"), 400)
}
ws.onmessage = event => {
  console.log('MESSAGE', typeof event.data, event.data.byteLength ?? 0)
  setTimeout(() => process.exit(0), 50)
}
ws.onerror = () => { console.log('ERROR'); process.exit(1) }
setTimeout(() => process.exit(0), 8000)
      `.trim()

      const result = await runAsync(process.execPath, ['-e', script])

      expect(result.stdout).toContain('OPEN')
      expect(result.stdout).toMatch(/MESSAGE object \d+/)
      expect(result.exitCode).toBe(0)

      expect(await server.stop()).toBe(0)
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
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

    await server.handle(new Request('http://localhost/api/health'))
    expect(server.keepAlives).toEqual([0])
  })

  test('delivers a later event on a stream idle past the server idle timeout', async () => {
    /*
     * Integration/compatibility test: verifies the final behavior on a runtime
     * that enforces idleTimeout. On Bun 1.4.2 a quiet ReadableStream response is
     * not closed by idleTimeout, so this does not by itself demonstrate the
     * timeout contract; the per-request opt-out test above does.
     */
    const server = await startServer({ IDLE_TIMEOUT: '1' })
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
  })
})

describe('Server readiness', () => {
  test('ready resolves once the initial build succeeds', async () => {
    const server = new Server()
      .root(fixtureRoot)
      .main('./Application.tsx')
      .start({ hostname: '127.0.0.1', port: 0, version: 'test-version' })

    try {
      await expect(server.ready()).resolves.toBeUndefined()
    } finally {
      server.stop()
    }
  })

  test('ready rejects when the SSR entrypoint exports no application component', async () => {
    const server = new Server()
      .root(fixtureRoot)
      .main('./NoApplication.tsx')
      .start({ hostname: '127.0.0.1', logger: new Logger({ silent: true }), port: 0 })

    try {
      await expect(server.ready()).rejects.toThrow('must export Application')
      const health = await server.handle(new Request(`http://127.0.0.1:${server.port}/api/health`))
      expect(health?.status).toBe(503)
      expect(await health?.json()).toMatchObject({ status: 'error' })
    } finally {
      await server.shutdown()
    }
  })

  test('ready rejects when the initial build fails', async () => {
    const server = new Server()
      .root(fixtureRoot)
      .main('./Broken.tsx')
      .start({ hostname: '127.0.0.1', port: 0, version: 'test-version' })

    try {
      await expect(server.ready()).rejects.toThrow()
    } finally {
      server.stop()
    }
  })
})

describe('Builder', () => {
  test('does not establish a watcher when watching is disabled', async () => {
    const builder = new Builder({ root: fixtureRoot, watch: false })
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
    const builder = new Builder({ root: fixtureRoot, watch: true })
    await builder.add('index.js', './Application.tsx')
    await builder.initialBuild()

    expect(builder.watching).toBe(true)

    await builder.stop()
    expect(builder.watching).toBe(false)
  })
})

describe('Builder file watching', () => {
  test('rebuilds when an imported asset changes in development', async () => {
    const dir = tempDirectory('basis-asset-watch')

    try {
      await Bun.write(join(dir, 'pixel.png'), await Bun.file(join(fixtureRoot, 'pixel.png')).arrayBuffer())
      await Bun.write(
        join(dir, 'entry.ts'),
        "import pixel from './pixel.png'\n;(globalThis as { __pixel?: string }).__pixel = pixel\n",
      )

      let rebuilds = 0
      const builder = new Builder({
        development: true,
        onRebuild: () => { rebuilds += 1 },
        root: dir,
        watch: true,
      })

      try {
        await builder.add('index.js', './entry.ts')
        const initial = await builder.initialBuild()
        const before = initial.find(output => output.output.kind === 'asset')
        if (!before) throw new Error('the initial build emitted no asset')
        const beforeBytes = new Uint8Array(await before.output.arrayBuffer())

        /*
         * The changed file is an imported asset, not TS/JS, but it is a bundle
         * input: the watcher must rebuild and emit the new bytes.
         */
        rebuilds = 0
        await Bun.write(join(dir, 'pixel.png'), new Uint8Array([...beforeBytes, 0]))

        const deadline = Date.now() + 15_000
        let changed = false
        while (!changed && Date.now() < deadline) {
          const outputs = await builder.getOutputs()
          const asset = outputs.find(output => output.output.kind === 'asset')
          if (asset) {
            changed = new Uint8Array(await asset.output.arrayBuffer()).length !== beforeBytes.length
          }
          if (!changed) await Bun.sleep(50)
        }

        expect(rebuilds).toBeGreaterThan(0)
        expect(changed).toBe(true)
      } finally {
        await builder.stop()
      }
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
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

describe('Server graph configuration', () => {
  test('accepts Graph-derived database configuration without a second model', () => {
    const graph = new Graph({ entities: [{ fields: [], name: 'Note' }] })
    const server = new Server()
      .graph(graph)
      .database({ image: 'postgres:17-alpine' })

    expect(() => server.graph(graph)).not.toThrow()
    expect(() => server.database({ image: 'postgres:17-alpine' })).not.toThrow()
    expect(() => server.database({ url: 'postgresql://127.0.0.1:1/basis' } as never))
      .toThrow('unsupported database option')
  })

  test('rejects external PostgreSQL configuration', () => {
    expect(() => new Server().database({
      url: 'postgres://basis:basis@127.0.0.1:1/basis',
    } as never)).toThrow('unsupported database option')
  })

  test('uses a null capability when no database is configured', async () => {
    const server = new Server()
      .start({ hostname: '127.0.0.1', logger: new Logger({ silent: true }), port: 0 })

    try {
      await expect(server.db.connect()).rejects.toThrow('No database is configured for this server')
      await expect(server.db.tx(async sql => { void sql })).rejects.toThrow('No database is configured for this server')
      expect(() => server.db.sql).toThrow('No database is configured for this server')
    } finally {
      await server.shutdown()
    }

    expect(server.db.closed).toBe(true)
  })
})

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
      .start({ hostname: '127.0.0.1', logger, port: 0, version: 'test-version' })

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
      .start({ hostname: '127.0.0.1', logger, port: 0, version: 'test-version' })

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
  test('accepts upgrades on a registered route', async () => {
    const server = await startServer()

    /*
     * Connect from a native child process: the happy-dom test preload replaces
     * `WebSocket` with a browser stand-in that does not perform a real upgrade.
     */
    const script = `
const ws = new WebSocket('ws://127.0.0.1:${server.port}/echo')
ws.onopen = () => { console.log('connected'); ws.close(); process.exit(0) }
ws.onerror = () => { console.log('failed'); process.exit(1) }
setTimeout(() => { console.log('timeout'); process.exit(2) }, 5000)
    `.trim()

    const result = await runAsync(process.execPath, ['-e', script])

    expect(result.stdout).toContain('connected')
    expect(result.exitCode).toBe(0)

    expect(await server.stop()).toBe(0)
  })
})

const favIconFixture = join(repoRoot, 'testing', 'favicon', 'serve.ts')

describe('Server favicon', () => {
  test('discovers, serves, and links a favicon at the app root', async () => {
    const dir = tempDirectory('basis-favicon')

    try {
      const bytes = new Uint8Array([1, 2, 3, 4])
      await Bun.write(join(dir, 'favicon.png'), bytes)

      const server = await startServer({ ROOT: dir }, favIconFixture)
      const base = `http://127.0.0.1:${server.port}`
      await waitForHealth(base, (result, payload) => result.status === 200 && payload.status === 'ok')

      const shell = await Bun.fetch(base).then(response => response.text())
      expect(shell).toContain('rel="icon"')
      expect(shell).toContain('href="/assets/favicon"')

      const response = await Bun.fetch(`${base}/assets/favicon`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/png')
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)

      expect(await server.stop()).toBe(0)
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  })

  test('serves an IconBase favicon at the standard URL', async () => {
    const server = await startServer({ COLOR: 'ff0000', FAVICON: 'icon', FILLED: 'true' }, favIconFixture)
    const base = `http://127.0.0.1:${server.port}`
    await waitForHealth(base, (result, payload) => result.status === 200 && payload.status === 'ok')

    const shell = await Bun.fetch(base).then(response => response.text())
    expect(shell).toContain('rel="icon"')
    expect(shell).toContain('href="/assets/favicon"')

    const svg = await Bun.fetch(`${base}/assets/favicon`).then(response => response.text())
    expect(svg).toContain('stroke="#ff0000"')

    expect(await server.stop()).toBe(0)
  })

  test('renders Basis and app icons at /icons/{Name}.svg with query options', async () => {
    const server = await startServer({}, favIconFixture)
    const base = `http://127.0.0.1:${server.port}`
    await waitForHealth(base, (result, payload) => result.status === 200 && payload.status === 'ok')

    const basis = await Bun.fetch(`${base}/icons/TriangleRight.svg?color=00ff00`).then(response => response.text())
    expect(basis).toContain('stroke="#00ff00"')

    const custom = await Bun.fetch(`${base}/icons/Custom.svg`).then(response => response.text())
    expect(custom).toContain('<svg')

    expect((await Bun.fetch(`${base}/icons/NotAnIcon.svg`)).status).toBe(404)

    expect(await server.stop()).toBe(0)
  })

  test('injects the favicon link into the development shell', async () => {
    const server = await startServer({ COLOR: '0000ff', FAVICON: 'icon' }, favIconFixture)
    const base = `http://127.0.0.1:${server.port}`
    await waitForHealth(base, (result, payload) => result.status === 200 && payload.status === 'ok')

    const shell = await Bun.fetch(base).then(response => response.text())
    expect(shell).toContain('rel="icon"')
    expect(shell).toContain('href="/assets/favicon"')

    expect(await server.stop()).toBe(0)
  })

  test('defaults to the Basis mark when nothing is configured or discovered', async () => {
    const dir = tempDirectory('basis-nofavicon')

    try {
      const server = await startServer({ ROOT: dir }, favIconFixture)
      const base = `http://127.0.0.1:${server.port}`
      await waitForHealth(base, (result, payload) => result.status === 200 && payload.status === 'ok')

      const shell = await Bun.fetch(base).then(response => response.text())
      expect(shell).toContain('href="/assets/favicon"')

      const svg = await Bun.fetch(`${base}/assets/favicon`).then(response => response.text())
      expect(svg).toContain('<svg')

      expect(await server.stop()).toBe(0)
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  })
})
