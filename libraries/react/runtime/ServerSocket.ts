import type { ServerEvent, ServerEventsStatus } from './ServerEvent'
import { parseServerEvent } from './ServerEvent'

/** Delay before reconnecting a dropped WebSocket. */
const RECONNECT_MS = 1_000

/**
 * A reusable WebSocket subscription to one endpoint.
 *
 * The transport owns connection lifecycle and reconnection, so application code
 * never constructs a `WebSocket`. Frames use the shared `{ event, data }`
 * envelope emitted by `Socket.publish` on the server.
 */
export class ServerSocket {
  #closed = false
  #handlers = new Set<(event: ServerEvent) => void>()
  #retry: ReturnType<typeof setTimeout> | null = null
  #socket: WebSocket | null = null
  #status: ServerEventsStatus = 'closed'

  constructor(private readonly url: string) {}

  /**
   * Connection status.
   * @returns The current status.
   */
  get status(): ServerEventsStatus {
    return this.#status
  }

  /**
   * The subscribed endpoint.
   * @returns The endpoint URL.
   */
  get endpoint(): string {
    return this.url
  }

  /**
   * Register an event handler, opening the connection on first use.
   * @param handler - Called for each server-published event.
   * @returns A disposer that removes the handler.
   */
  subscribe(handler: (event: ServerEvent) => void): () => void {
    this.#handlers.add(handler)
    if (!this.#closed && this.#socket === null) this.#connect()
    return () => {
      this.#handlers.delete(handler)
    }
  }

  /** Close the connection and stop reconnecting. */
  close(): void {
    this.#closed = true
    if (this.#retry !== null) {
      clearTimeout(this.#retry)
      this.#retry = null
    }
    this.#socket?.close()
    this.#socket = null
    this.#handlers.clear()
    this.#status = 'closed'
  }

  /**
   * Publish one frame to the handlers.
   * @param raw - Raw frame text.
   */
  #dispatch(raw: string): void {
    const event = parseServerEvent(raw)
    if (event === null) return
    for (const handler of Array.from(this.#handlers)) {
      try {
        handler(event)
      } catch {
        // A failing subscriber must not tear down the transport.
      }
    }
  }

  /** Open the underlying `WebSocket`. */
  #connect(): void {
    if (typeof WebSocket === 'undefined') {
      this.#status = 'closed'
      return
    }
    const socket = new WebSocket(this.url)
    this.#socket = socket
    this.#status = 'connecting'
    socket.onopen = () => {
      if (this.#closed) {
        socket.close()
        return
      }
      this.#status = 'open'
    }
    socket.onmessage = event => this.#dispatch(String(event.data))
    socket.onclose = () => {
      this.#socket = null
      this.#status = 'closed'
      this.#scheduleReconnect()
    }
    socket.onerror = () => {
      // `onclose` follows and owns reconnection.
    }
  }

  /** Schedule a reconnect while the subscription is still wanted. */
  #scheduleReconnect(): void {
    if (this.#closed || this.#retry !== null || this.#handlers.size === 0) return
    this.#retry = setTimeout(() => {
      this.#retry = null
      if (!this.#closed && this.#socket === null && this.#handlers.size > 0) this.#connect()
    }, RECONNECT_MS)
  }
}
