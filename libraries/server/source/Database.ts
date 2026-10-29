import { SQL } from 'bun'

/** Connection and pool options for a PostgreSQL database capability. */
export interface DatabaseOptions {
  /** Maximum seconds to wait when establishing a connection. */
  connectionTimeout?: number,
  /** Maximum seconds a connection may sit idle before it is closed. */
  idleTimeout?: number,
  /** Maximum number of connections in the pool. Defaults to Bun's pool default. */
  max?: number,
  /** PostgreSQL connection URL. */
  url: string | URL,
}

/**
 * A server-owned Bun PostgreSQL pool.
 *
 * The capability owns one native {@link SQL} pool and its lifecycle. It does
 * not create module globals; configure it through {@link Server.database} so
 * the server can close it on shutdown.
 */
export class Database {
  #closed = false
  #closing: Promise<void> | null = null
  #sql: SQL

  /**
   * Creates the pool. Connections are established lazily by {@link connect} or
   * the first query.
   * @param options - The connection URL and pool options.
   * @param options.url - The PostgreSQL connection URL.
   */
  constructor({ url, ...options }: DatabaseOptions) {
    this.#sql = new SQL({ ...options, url })
  }

  /**
   * Whether the pool has been closed.
   * @returns `true` once {@link close} has started.
   */
  get closed(): boolean {
    return this.#closed
  }

  /**
   * Establishes the pool's initial connection.
   * @returns A promise that resolves once the connection is established.
   * @throws {Error} When the server is unreachable or the pool is closed.
   */
  async connect(): Promise<void> {
    if (this.#closed) throw new Error('Database is closed')
    await this.#sql.connect()
  }

  /**
   * Closes the pool exactly once. Later calls resolve with the same result.
   * @returns A promise that resolves when the pool is closed.
   */
  close(): Promise<void> {
    if (!this.#closing) {
      this.#closed = true
      this.#closing = this.#sql.close()
    }
    return this.#closing
  }
}
