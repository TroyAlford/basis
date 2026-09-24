import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { ServerEvent } from './ServerEvent'
import { parseServerEvent } from './ServerEvent'
import { ServerEvents } from './ServerEvents'
import { ServerSocket } from './ServerSocket'
import { ServerSubscriptions } from './ServerSubscriptions'

/** Minimal `EventSource` stand-in that records instances and lets tests drive it. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  closed = false
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  close(): void { this.closed = true }
  emit(data: string): void { this.onmessage?.({ data }) }
  fail(): void { this.onerror?.() }
  open(): void { this.onopen?.() }
}

/** Minimal `WebSocket` stand-in that records instances and lets tests drive it. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  closed = false
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  sent: string[] = []
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  close(): void { this.closed = true; this.onclose?.() }
  emit(data: string): void { this.onmessage?.({ data }) }
  open(): void { this.onopen?.() }
  send(data: string): void { this.sent.push(data) }
}

const globals = globalThis as unknown as Record<string, unknown>
let originalEventSource: unknown
let originalWebSocket: unknown

beforeEach(() => {
  originalEventSource = globals.EventSource
  originalWebSocket = globals.WebSocket
  FakeEventSource.instances = []
  FakeWebSocket.instances = []
  globals.EventSource = FakeEventSource
  globals.WebSocket = FakeWebSocket
})

afterEach(() => {
  globals.EventSource = originalEventSource
  globals.WebSocket = originalWebSocket
})

describe('parseServerEvent', () => {
  test('parses the shared envelope', () => {
    expect(parseServerEvent('{"event":"snapshot","data":{"ok":true}}'))
      .toEqual({ data: { ok: true }, event: 'snapshot' })
  })

  test('surfaces a plain frame as a message event', () => {
    expect(parseServerEvent('{"ok":true}')).toEqual({ data: { ok: true }, event: 'message' })
    expect(parseServerEvent('not json')).toEqual({ data: 'not json', event: 'message' })
  })

  test('ignores empty frames', () => {
    expect(parseServerEvent('')).toBeNull()
  })
})

describe('ServerEvents', () => {
  test('opens one EventSource on first subscribe and dispatches events', () => {
    const received: ServerEvent[] = []
    const events = new ServerEvents('/events')

    const dispose = events.subscribe(event => received.push(event))
    const source = FakeEventSource.instances[0]
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(source.url).toBe('/events')
    expect(events.status).toBe('connecting')

    source.open()
    expect(events.status).toBe('open')

    source.emit('{"event":"snapshot","data":{"n":1}}')
    expect(received).toEqual([{ data: { n: 1 }, event: 'snapshot' }])

    dispose()
    source.fail()
    expect(events.status).toBe('connecting')
  })

  test('a throwing handler does not stop other handlers', () => {
    const received: string[] = []
    const events = new ServerEvents('/events')
    events.subscribe(() => {
      throw new Error('boom')
    })
    events.subscribe(event => received.push(event.event))

    FakeEventSource.instances[0].emit('{"event":"tick","data":1}')

    expect(received).toEqual(['tick'])
  })

  test('close tears down the source and handlers', () => {
    const events = new ServerEvents('/events')
    events.subscribe(() => undefined)
    const source = FakeEventSource.instances[0]

    events.close()

    expect(source.closed).toBe(true)
    expect(events.status).toBe('closed')
  })
})

describe('ServerSocket', () => {
  test('connects, dispatches envelope frames, and closes', () => {
    const received: ServerEvent[] = []
    const socket = new ServerSocket('ws://localhost/events')
    socket.subscribe(event => received.push(event))

    const ws = FakeWebSocket.instances[0]
    expect(ws.url).toBe('ws://localhost/events')
    ws.open()
    expect(socket.status).toBe('open')

    ws.emit('{"event":"tick","data":2}')
    expect(received).toEqual([{ data: 2, event: 'tick' }])

    socket.close()
    expect(ws.closed).toBe(true)
    expect(socket.status).toBe('closed')
  })
})

describe('ServerSubscriptions', () => {
  test('shares one connection per endpoint and closes it with the last subscriber', () => {
    const received: ServerEvent[] = []
    const manager = new ServerSubscriptions(event => received.push(event))

    const first = manager.subscribe({ url: '/events' })
    const second = manager.subscribe({ url: '/events' })
    expect(FakeEventSource.instances).toHaveLength(1)

    FakeEventSource.instances[0].open()
    expect(manager.status).toBe('open')
    FakeEventSource.instances[0].emit('{"event":"snapshot","data":1}')
    expect(received).toHaveLength(1)

    first()
    expect(FakeEventSource.instances[0].closed).toBe(false)

    second()
    expect(FakeEventSource.instances[0].closed).toBe(true)
    expect(manager.status).toBe('closed')
  })

  test('keeps transports distinct for the same endpoint', () => {
    const manager = new ServerSubscriptions(() => undefined)
    manager.subscribe({ transport: 'sse', url: '/events' })
    manager.subscribe({ transport: 'socket', url: '/events' })

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeWebSocket.instances).toHaveLength(1)

    manager.closeAll()
    expect(FakeEventSource.instances[0].closed).toBe(true)
    expect(FakeWebSocket.instances[0].closed).toBe(true)
  })
})
