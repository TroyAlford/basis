import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpVerb, Logger, parseURI } from '../../utilities'
import { Server } from './Server'
import { sseResponse } from './Sse'
import { normalizeMountPrefix, serveMount } from './StaticMount'

const silent = new Logger({ colors: false, silent: true })

/**
 * Build a request-like context whose signal the test controls.
 * @param controller - Controller whose signal the SSE stream should observe.
 * @returns The request shape `sseResponse` consumes.
 */
function requestWith(controller: AbortController): Request {
  return { signal: controller.signal } as unknown as Request
}

describe('sseResponse', () => {
  test('writes named events as an event stream and runs teardown on disconnect', async () => {
    const controller = new AbortController()
    const closed: string[] = []
    const response = sseResponse(
      {},
      { logger: silent, request: requestWith(controller) },
      (_params, _context, channel) => {
        channel.send('snapshot', { ok: true })
        channel.onClose(() => closed.push('stream-closed'))
      },
    )

    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-accel-buffering')).toBe('no')

    const reader = response.body?.getReader()
    const first = await reader?.read()
    expect(new TextDecoder().decode(first?.value))
      .toBe('data: {"data":{"ok":true},"event":"snapshot"}\n\n')

    controller.abort()
    await Bun.sleep(0)
    expect(closed).toEqual(['stream-closed'])
    await reader?.cancel()
  })

  test('drops frames beyond the bounded buffer instead of queuing without limit', async () => {
    const accepted = { value: 0 }
    const response = sseResponse(
      {},
      { logger: silent, request: requestWith(new AbortController()) },
      (_params, _context, channel) => {
        for (let index = 0; index < 100; index += 1) {
          if (channel.send('tick', index)) accepted.value += 1
        }
        channel.close()
      },
    )

    expect(accepted.value).toBe(16)

    const text = await response.text()
    expect(text.match(/"event":"tick"/g) ?? []).toHaveLength(16)
  })

  test('runs every teardown exactly once', () => {
    const closed: string[] = []
    sseResponse(
      {},
      { logger: silent, request: requestWith(new AbortController()) },
      (_params, _context, channel) => {
        channel.onClose(() => closed.push('once'))
        channel.onClose(() => closed.push('twice'))
        channel.close()
        channel.close()
      },
    )

    expect(closed).toEqual(['once', 'twice'])
  })
})

describe('Server.sse', () => {
  test('streams a full snapshot to each connection', async () => {
    let connections = 0
    const server = new Server().sse('events', (_params, _context, channel) => {
      connections += 1
      channel.send('snapshot', { connections })
      channel.close()
    })

    const read = async (): Promise<string> => {
      const uri = parseURI('http://localhost/events')
      const response = await server.handleSse(uri, new Request('http://localhost/events'))
      return await response?.text() ?? ''
    }

    expect(await read()).toContain('"connections":1')
    expect(await read()).toContain('"connections":2')
  })

  test('is GET-only', async () => {
    const server = new Server().sse('events', () => undefined)
    const uri = parseURI('http://localhost/events')
    const response = await server.handleSse(uri, new Request('http://localhost/events', { method: 'POST' }))

    expect(response?.status).toBe(405)
    expect(response?.headers.get('allow')).toBe('GET')
  })
})

describe('Server.api route context', () => {
  test('passes the request and the server logger to the handler', async () => {
    const server = new Server().api([HttpVerb.Get], 'whoami', (_params, context) => Response.json({
      hasRequest: context.request.url.length > 0,
      isLogger: context.logger === server.logger,
    }))

    const uri = parseURI('http://localhost/whoami')
    const response = await server.handleAPI(uri, new Request('http://localhost/whoami'))

    expect(await response?.json()).toEqual({ hasRequest: true, isLogger: true })
  })
})

describe('Server.mount', () => {
  test('serves allow-listed files and rejects traversal, disallowed entries, and misses', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'basis-mount-'))
    try {
      mkdirSync(join(directory, 'allowed'))
      mkdirSync(join(directory, 'secret'))
      writeFileSync(join(directory, 'allowed', 'app.css'), 'body { color: red; }')
      writeFileSync(join(directory, 'secret', 'token.txt'), 'nope')

      const server = new Server().mount('/vendor', directory, { allow: ['allowed'] })
      const fetchPath = async (path: string): Promise<Response | null> => (
        await server.handleMount(parseURI(`http://localhost${path}`))
      )

      const allowed = await fetchPath('/vendor/allowed/app.css')
      expect(allowed?.status).toBe(200)
      expect(allowed?.headers.get('content-type')).toContain('text/css')
      expect(allowed?.body).not.toBeNull()

      expect((await fetchPath('/vendor/secret/token.txt'))?.status).toBe(404)
      expect((await fetchPath('/vendor/allowed/missing.css'))?.status).toBe(404)
      /*
       * WHATWG URL normalizes dot segments before the server sees them, so a
       * traversal attempt is either not claimed by the mount or rejected.
       */
      const traversal = await fetchPath('/vendor/allowed/%2e%2e%2fsecret/token.txt')
      expect(traversal === null || traversal.status === 404).toBe(true)

      // `serveMount` is the security boundary: it rejects an encoded traversal.
      const boundary = await serveMount(
        { allow: ['allowed'], folder: directory, prefix: normalizeMountPrefix('/vendor') },
        '/vendor/allowed/%2e%2e%2fsecret/token.txt',
      )
      expect(boundary?.status).toBe(404)

      // Paths outside the mount are not claimed.
      expect(await fetchPath('/somewhere')).toBeNull()
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})

describe('Server runtime context', () => {
  test('embeds SERVICE_NAME, VERSION, and GIT_SHA into the SPA shell', async () => {
    const previous = {
      GIT_SHA: process.env.GIT_SHA,
      SERVICE_NAME: process.env.SERVICE_NAME,
      VERSION: process.env.VERSION,
    }
    process.env.SERVICE_NAME = 'mtg-proxifier'
    process.env.VERSION = '1.2.3'
    process.env.GIT_SHA = 'abc123'

    try {
      const server = new Server().title('MTG: Proxies')
      const html = await (await server.handleUI()).text()

      expect(html).toContain('<title>MTG: Proxies</title>')
      expect(html).toContain('id="basis-runtime"')
      expect(html).toContain('mtg-proxifier')
      expect(html).toContain('1.2.3')
      expect(html).toContain('abc123')
      expect(server.runtime).toEqual({ gitSha: 'abc123', serviceName: 'mtg-proxifier', version: '1.2.3' })
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
    }
  })
})
