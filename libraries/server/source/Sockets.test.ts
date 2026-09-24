import type { ServerWebSocket } from 'bun'
import { describe, expect, test } from 'bun:test'
import type { SocketData } from './Sockets'
import { createSocket, normalizeSocketTemplate } from './Sockets'

/**
 * Build a minimal fake Bun server socket.
 * @returns The fake socket plus the frames and closes it recorded.
 */
function fakeServerSocket() {
  const closes: [number | undefined, string | undefined][] = []
  const sent: (string | Uint8Array)[] = []
  const ws = {
    close: (code?: number, reason?: string) => closes.push([code, reason]),
    data: { params: { id: '7' }, route: 'room/:id', socket: null } as SocketData,
    remoteAddress: '203.0.113.9',
    send: (data: string | Uint8Array) => {
      sent.push(data)
      return 1
    },
  } as unknown as ServerWebSocket<SocketData>
  return { closes, sent, ws }
}

describe('createSocket', () => {
  test('exposes params, address, publish, raw send, and close', () => {
    const { closes, sent, ws } = fakeServerSocket()
    const socket = createSocket(ws)

    expect(socket.params).toEqual({ id: '7' })
    expect(socket.remoteAddress).toBe('203.0.113.9')

    expect(socket.publish('tick', { n: 1 })).toBe(true)
    expect(sent[0]).toBe(JSON.stringify({ data: { n: 1 }, event: 'tick' }))

    expect(socket.send('raw')).toBe(true)
    expect(sent[1]).toBe('raw')

    socket.close(1000, 'bye')
    expect(closes).toEqual([[1000, 'bye']])
  })

  test('reports a missing remote address as null', () => {
    const { ws } = fakeServerSocket();
    (ws as { remoteAddress: string }).remoteAddress = ''

    expect(createSocket(ws).remoteAddress).toBeNull()
  })
})

describe('normalizeSocketTemplate', () => {
  test('adds a leading slash without changing rooted templates', () => {
    expect(normalizeSocketTemplate('hmr')).toBe('/hmr')
    expect(normalizeSocketTemplate('/hmr')).toBe('/hmr')
    expect(normalizeSocketTemplate('/room/:id')).toBe('/room/:id')
  })
})
