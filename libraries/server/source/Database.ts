import { SQL } from 'bun'
import { createHash, randomUUID } from 'node:crypto'
import { merge } from '../../utilities/functions/merge'

/** The pool options used by every PostgreSQL connection. */
type PoolOptions = Pick<DatabaseOptions, 'connectionTimeout' | 'idleTimeout' | 'max'>

/** The pool defaults applied before the caller's options. */
const DEFAULTS: PoolOptions = {
  connectionTimeout: 10,
  idleTimeout: 30,
  max: 10,
}

/** The PostgreSQL image used by the managed local database. */
const MANAGED_IMAGE = 'postgres:17-alpine'
/** The managed database's user and database name. */
const MANAGED_NAME = 'basis'
/** The PostgreSQL port inside the managed container. */
const MANAGED_PORT = 5432
/** How long to wait for the managed container to accept connections. */
const READY_TIMEOUT_MS = 60_000
/** How often to poll the managed container's readiness. */
const READY_POLL_MS = 200
/** Error shown when a managed database is configured without Docker. */
const DOCKER_REQUIRED =
  'A managed database requires Docker. Install Docker or declare "docker" in ' +
  'basis.hostDependencies for this application.'

/** Connection and pool options for a PostgreSQL database capability. */
export interface DatabaseOptions {
  /** Maximum seconds to wait when establishing a connection. Defaults to 10. */
  connectionTimeout?: number,
  /** Maximum seconds a connection may sit idle before it is closed. Defaults to 30. */
  idleTimeout?: number,
  /** Maximum number of connections in the pool. Defaults to 10. */
  max?: number,
  /**
   * Stable application scope for a managed database. Its data volume and
   * credentials persist across restarts. Defaults to `SERVICE_NAME`, then the
   * process working directory.
   */
  name?: string,
  /**
   * External PostgreSQL connection URL. When omitted, the server starts a
   * managed local PostgreSQL container instead.
   */
  url?: string | URL,
}

/** A server-owned database capability. */
export interface Database {
  /** Closes the database and releases its resources. */
  close(): Promise<void>,
  /** Whether the capability has been closed. */
  readonly closed: boolean,
  /** Establishes the database connection. */
  connect(): Promise<void>,
  /** The pooled Bun SQL tagged-template API. */
  readonly sql: SQL,
}

/** Docker command result. */
interface DockerResult {
  /** Process exit code. */
  code: number,
  /** Standard error. */
  stderr: string,
  /** Standard output. */
  stdout: string,
}

/**
 * Run a Docker CLI command and capture its output.
 * @param args - Arguments after `docker`.
 * @returns The exit code and captured output.
 */
async function docker(args: string[]): Promise<DockerResult> {
  const executable = Bun.which('docker')
  if (!executable) throw new Error(DOCKER_REQUIRED)

  const child = Bun.spawn([executable, ...args], { stderr: 'pipe', stdout: 'pipe' })
  const decoder = new TextDecoder()
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).arrayBuffer(),
    child.exited,
  ])

  return {
    code,
    stderr: decoder.decode(stderr),
    stdout: decoder.decode(stdout),
  }
}

/**
 * Extract the published localhost port from `docker port` output.
 * @param output - Output such as `127.0.0.1:49152`.
 * @returns The port, or null when no port was published.
 */
function publishedPort(output: string): number | null {
  const match = /:(\d+)\s*$/m.exec(output.trim())
  return match ? Number(match[1]) : null
}

/**
 * A PostgreSQL pool backed by an explicit connection URL.
 *
 * Instances are owned by the server; callers reach them through `server.db`.
 */
class PostgresDatabase implements Database {
  #closed = false
  #closing: Promise<void> | null = null
  #sql: SQL

  /**
   * Creates the pool.
   * @param options - The connection URL and pool options.
   * @param options.connectionTimeout - Maximum seconds to establish a connection.
   * @param options.idleTimeout - Maximum seconds a connection may sit idle.
   * @param options.max - Maximum number of connections in the pool.
   * @param options.url - The PostgreSQL connection URL.
   */
  constructor({ connectionTimeout, idleTimeout, max, url }: DatabaseOptions & { url: string | URL }) {
    const overrides = Object.fromEntries(
      Object.entries({ connectionTimeout, idleTimeout, max })
        .filter(([, value]) => value !== undefined),
    ) as PoolOptions
    this.#sql = new SQL({ ...merge(DEFAULTS, overrides), url })
  }

  /**
   * Whether the pool has been closed.
   * @returns `true` once {@link close} has started.
   */
  get closed(): boolean {
    return this.#closed
  }

  /**
   * The pooled Bun SQL tagged-template API.
   * @returns The underlying Bun SQL instance.
   */
  get sql(): SQL {
    return this.#sql
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

/** The database capability used when a server has no database configured. */
export class NullDatabase implements Database {
  #closed = false

  /**
   * Whether the capability has been closed.
   * @returns `true` once {@link close} has started.
   */
  get closed(): boolean {
    return this.#closed
  }

  /**
   * Throws because no database is configured.
   * @throws {Error} Always, naming the missing configuration.
   */
  get sql(): SQL {
    throw new Error('No database is configured for this server')
  }

  /**
   * Rejects because no database is configured.
   * @returns A rejected promise naming the missing configuration.
   */
  connect(): Promise<void> {
    return Promise.reject(new Error('No database is configured for this server'))
  }

  /**
   * Marks the capability closed.
   * @returns A promise that resolves immediately.
   */
  close(): Promise<void> {
    this.#closed = true
    return Promise.resolve()
  }
}

/**
 * A managed local PostgreSQL container and its pool.
 *
 * Docker is the only supported host capability for a managed database. The
 * server assigns the container an ephemeral host port, waits for PostgreSQL to
 * accept connections, and owns the container/pool lifecycle.
 */
class ManagedDatabase implements Database {
  #closed = false
  #closing: Promise<void> | null = null
  #connecting: Promise<void> | null = null
  #container: string | null = null
  #containerName: string
  #database: PostgresDatabase | null = null
  #name: string
  #options: Omit<DatabaseOptions, 'name' | 'url'>
  #volume: string

  /**
   * Creates the managed database capability. The container starts on
   * {@link connect}.
   * @param options - Pool options and the stable application scope.
   * @param options.name - Stable managed database scope.
   */
  constructor({ name, ...options }: Omit<DatabaseOptions, 'url'>) {
    this.#name = name?.trim() || Bun.env.SERVICE_NAME?.trim() || process.cwd()
    const identity = createHash('sha1').update(this.#name).digest('hex').slice(0, 16)
    this.#volume = `basis-postgres-${identity}`
    this.#containerName = this.#volume
    this.#options = options
  }

  /**
   * Whether the capability has been closed.
   * @returns `true` once {@link close} has started.
   */
  get closed(): boolean {
    return this.#closed
  }

  /**
   * The pooled Bun SQL tagged-template API.
   * @returns The connected pool's Bun SQL instance.
   * @throws {Error} Before the managed database is connected or after close.
   */
  get sql(): SQL {
    if (!this.#database) throw new Error('Managed database is not connected')
    return this.#database.sql
  }

  /**
   * Starts the database container and connects to it.
   * @returns A promise that resolves once PostgreSQL is ready.
   * @throws {Error} When Docker is missing, the container fails, or the pool closes.
   */
  connect(): Promise<void> {
    if (this.#closed) return Promise.reject(new Error('Database is closed'))
    if (!this.#connecting) {
      const connecting = this.#start()
      this.#connecting = connecting
      void connecting.catch(() => {
        if (this.#connecting === connecting) this.#connecting = null
      })
    }
    return this.#connecting
  }

  /**
   * Closes the pool and removes the managed container exactly once.
   * @returns A promise that resolves when teardown finishes.
   */
  close(): Promise<void> {
    if (!this.#closing) {
      this.#closed = true
      this.#closing = this.#stop()
    }
    return this.#closing
  }

  /** Starts the container, waits for readiness, and connects the pool. */
  async #start(): Promise<void> {
    const password = await this.#ensureVolume()
    await docker(['rm', '-f', this.#containerName])

    const run = await docker([
      'run', '-d', '--rm', '--pull', 'missing',
      '--name', this.#containerName,
      '--label', `basis.database=${this.#name}`,
      '-e', `POSTGRES_USER=${MANAGED_NAME}`,
      '-e', `POSTGRES_PASSWORD=${password}`,
      '-e', `POSTGRES_DB=${MANAGED_NAME}`,
      '-v', `${this.#volume}:/var/lib/postgresql/data`,
      '-p', `127.0.0.1::${MANAGED_PORT}`,
      MANAGED_IMAGE,
    ])
    if (run.code !== 0) {
      const detail = run.stderr.trim() || `docker run exited with ${run.code}`
      throw new Error(`PostgreSQL container failed to start: ${detail}`)
    }

    this.#container = run.stdout.trim()
    try {
      const port = publishedPort((await docker(['port', this.#container, `${MANAGED_PORT}/tcp`])).stdout)
      if (port === null) throw new Error('PostgreSQL did not publish its port')

      const url = `postgres://${MANAGED_NAME}:${password}@127.0.0.1:${port}/${MANAGED_NAME}`
      await this.#connectWhenReady(url)
    } catch (error) {
      await this.#removeContainer()
      throw error
    }
  }

  /**
   * Resolve the durable data volume and its stable credentials.
   * @returns The password recorded for this application scope.
   */
  async #ensureVolume(): Promise<string> {
    const inspect = await docker([
      'volume', 'inspect', '--format', '{{ index .Labels "basis.password" }}', this.#volume,
    ])
    if (inspect.code === 0) {
      const password = inspect.stdout.trim()
      if (password && password !== '<no value>') return password
      throw new Error(
        `Managed database volume "${this.#volume}" exists without credentials; ` +
        'remove it or restore its basis.password label.',
      )
    }

    const password = randomUUID()
    const create = await docker([
      'volume', 'create',
      '--label', `basis.database=${this.#name}`,
      '--label', `basis.password=${password}`,
      this.#volume,
    ])
    if (create.code !== 0) {
      const detail = create.stderr.trim() || `docker volume create exited with ${create.code}`
      throw new Error(`Managed database volume failed to start: ${detail}`)
    }
    return password
  }

  /**
   * Retry the real pool connection until PostgreSQL accepts it.
   *
   * `pg_isready` can report ready while the database is still finishing its
   * startup, so readiness is the actual connection the pool will use.
   * @param url - The managed PostgreSQL connection URL.
   */
  async #connectWhenReady(url: string): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    let lastError: Error | null = null

    while (Date.now() < deadline) {
      if (this.#closed) throw new Error('Database is closed')

      const database = new PostgresDatabase({ ...this.#options, url })
      try {
        await database.connect()
        if (this.#closed) {
          await database.close()
          throw new Error('Database is closed')
        }
        this.#database = database
        return
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        await database.close().catch(() => undefined)
      }

      await Bun.sleep(READY_POLL_MS)
    }

    const logs = await docker(['logs', this.#container ?? ''])
    throw new Error(
      `PostgreSQL did not accept connections within ${READY_TIMEOUT_MS}ms ` +
      `(${lastError?.message ?? 'no connection'}):\n${logs.stdout}${logs.stderr}`,
    )
  }

  /** Waits for in-flight startup, closes the pool, and removes the container. */
  async #stop(): Promise<void> {
    await this.#connecting?.catch(() => undefined)
    await this.#database?.close()
    this.#database = null
    await this.#removeContainer()
  }

  /** Remove the managed container, ignoring an already-removed container. */
  async #removeContainer(): Promise<void> {
    const container = this.#container
    this.#container = null
    if (container === null) return
    await docker(['rm', '-f', container]).catch(() => undefined)
  }
}

/**
 * Create the database capability for a server.
 * @param options - Pool options and an optional external URL.
 * @returns The managed, external, or null database capability.
 */
export function createDatabase(options: DatabaseOptions = {}): Database {
  if (options.url) return new PostgresDatabase({ ...options, url: options.url })
  return new ManagedDatabase(options)
}
