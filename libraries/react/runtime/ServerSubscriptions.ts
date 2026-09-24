import type { ServerEvent, ServerEventsStatus } from './ServerEvent'
import { ServerEvents } from './ServerEvents'
import { ServerSocket } from './ServerSocket'

/** Transport used by a subscription definition. */
export type SubscriptionTransport = 'socket' | 'sse'

/** A server-published event source an application wants to observe. */
export interface SubscriptionDefinition {
  /** Transport to use; defaults to `sse`. */
  transport?: SubscriptionTransport,
  /** Absolute endpoint URL (for example `/events` or `/services/api/logs/stream`). */
  url: string,
}

/** One live connection shared by every subscriber of the same endpoint. */
interface Connection {
  /** The live transport. */
  readonly connection: ServerEvents | ServerSocket,
  /** Number of active subscribers. */
  count: number,
  /** Removes this manager's handler from the transport. */
  readonly off: () => void,
}

/**
 * Connection manager for an application's server-published subscriptions.
 *
 * ApplicationBase owns one of these and connects the definitions an application
 * declares; pages and components can subscribe to additional endpoints through
 * the runtime context instead of constructing transports themselves. One
 * connection is shared per endpoint and closed when its last subscriber leaves.
 */
export class ServerSubscriptions {
  #connections = new Map<string, Connection>()

  constructor(private readonly onEvent: (event: ServerEvent) => void) {}

  /**
   * Aggregate connection status across active subscriptions.
   * @returns `open` when any connection is open, else `connecting` when any is connecting, else `closed`.
   */
  get status(): ServerEventsStatus {
    let status: ServerEventsStatus = 'closed'
    for (const { connection } of this.#connections.values()) {
      if (connection.status === 'open') return 'open'
      if (connection.status === 'connecting') status = 'connecting'
    }
    return status
  }

  /**
   * Subscribe to one endpoint, opening a shared connection when needed.
   * @param definition - The endpoint and transport to observe.
   * @param definition.transport - Transport to use; defaults to `sse`.
   * @param definition.url - Absolute endpoint URL to observe.
   * @returns A disposer that releases this subscription.
   */
  subscribe({ transport = 'sse', url }: SubscriptionDefinition): () => void {
    const key = `${transport}:${url}`
    let entry = this.#connections.get(key)
    if (entry === undefined) {
      const connection = transport === 'socket' ? new ServerSocket(url) : new ServerEvents(url)
      entry = {
        connection,
        count: 0,
        off: connection.subscribe(event => this.onEvent(event)),
      }
      this.#connections.set(key, entry)
    }
    entry.count += 1

    let active = true
    return () => {
      if (!active) return
      active = false
      const current = this.#connections.get(key)
      if (current === undefined) return
      current.count -= 1
      if (current.count > 0) return
      current.off()
      current.connection.close()
      this.#connections.delete(key)
    }
  }

  /** Close every connection and release all handlers. */
  closeAll(): void {
    for (const { connection, off } of this.#connections.values()) {
      off()
      connection.close()
    }
    this.#connections.clear()
  }
}
