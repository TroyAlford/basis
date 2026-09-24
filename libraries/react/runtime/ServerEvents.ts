import type { ServerEvent, ServerEventsStatus } from './ServerEvent'
import { parseServerEvent } from './ServerEvent'

/**
 * A reusable Server-Sent Events subscription to one endpoint.
 *
 * The transport owns connection lifecycle and reconnection (the platform
 * `EventSource` reconnects automatically), so application code never
 * constructs an `EventSource`. The connection opens on first `subscribe` and
 * closes with {@link ServerEvents.close}.
 */
export class ServerEvents {
  #handlers = new Set<(event: ServerEvent) => void>()
  #source: EventSource | null = null
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
    if (this.#source === null) this.#connect()
    return () => {
      this.#handlers.delete(handler)
    }
  }

  /** Close the connection and release the handlers. */
  close(): void {
    this.#source?.close()
    this.#source = null
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

  /** Open the underlying `EventSource`. */
  #connect(): void {
    if (typeof EventSource === 'undefined') {
      this.#status = 'closed'
      return
    }
    const source = new EventSource(this.url)
    this.#source = source
    this.#status = 'connecting'
    source.onopen = () => {
      this.#status = 'open'
    }
    source.onerror = () => {
      // `EventSource` reconnects on its own; reflect the transient state.
      this.#status = 'connecting'
    }
    source.onmessage = event => this.#dispatch(String(event.data))
  }
}
