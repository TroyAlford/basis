import { runAsync } from 'basis/configuration'
import { SQL } from 'bun'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { EntityDefinitions } from './EntityDefinitions'
import { selectSQL } from './EntityDefinitions'

/** The pool defaults used by every managed or external connection. */
const POOL_DEFAULTS = {
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
  'A managed database requires Docker. Install Docker and make sure the daemon is running.'
/** The container mount for the host-owned password file. */
const PASSWORD_MOUNT = '/run/secrets/basis-postgres-password'

/** Options for a server-owned database capability. */
export interface DatabaseOptions {
  /** Canonical entity definitions used to validate and build `db.query`. */
  entities?: EntityDefinitions,
  /**
   * External PostgreSQL connection URL. When omitted, the server manages a
   * local PostgreSQL service with an application-scoped identity.
   */
  url?: string | URL,
}

/** Options for a root entity query. */
export interface QueryOptions {
  /** Root scalar fields to project, in output order. */
  fields: readonly string[],
}

/** A server-owned database capability. */
export interface Database {
  /** Closes the database pool and releases its resources. */
  close(): Promise<void>,
  /** Whether the pool has been closed. */
  readonly closed: boolean,
  /** Establishes the database pool's connection. */
  connect(): Promise<void>,
  /** Projects root scalar fields from one canonical entity. */
  query<T = Record<string, unknown>>(entity: string, options: QueryOptions): Promise<T[]>,
  /** The pooled Bun SQL tagged-template API. */
  readonly sql: SQL,
  /** Runs a callback inside a pooled Bun transaction. */
  tx<T>(callback: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>>,
}

/** A managed container's observed state. */
type ContainerState = 'missing' | 'running' | 'stopped'

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
  #entities: EntityDefinitions | undefined
  #sql: SQL

  /**
   * Creates the pool.
   * @param url - The PostgreSQL connection URL.
   * @param entities - Canonical definitions used for entity queries.
   */
  constructor(url: string | URL, entities?: EntityDefinitions) {
    this.#entities = entities
    this.#sql = new SQL({ ...POOL_DEFAULTS, url })
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

  /**
   * Project root scalar fields from one entity.
   * @param entity - Exact canonical entity name.
   * @param options - Fields to project.
   * @returns The selected rows.
   * @throws {Error} When no definitions are configured, the pool is closed, or the query is invalid.
   */
  async query<T = Record<string, unknown>>(entity: string, options: QueryOptions): Promise<T[]> {
    if (this.#closed) throw new Error('Database is closed')
    if (!this.#entities) throw new Error('No entity definitions are configured for this database')
    return await this.#sql.unsafe<T[]>(selectSQL(this.#entities, entity, options.fields))
  }

  /**
   * Runs a callback inside a Bun transaction on this pool.
   * @param callback - Transaction-scoped work.
   * @returns The callback result after commit.
   * @throws {Error} When the pool is closed or the callback fails.
   */
  tx<T>(callback: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>> {
    if (this.#closed) return Promise.reject(new Error('Database is closed'))
    return this.#sql.begin(callback)
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

  /**
   * Rejects because no database is configured.
   * @param entity - Entity name; unused without a database.
   * @param options - Query options; unused without a database.
   * @returns A rejected promise naming the missing configuration.
   */
  query<T = Record<string, unknown>>(entity: string, options: QueryOptions): Promise<T[]> {
    void entity
    void options
    return Promise.reject(new Error('No database is configured for this server'))
  }

  /**
   * Rejects because no database is configured.
   * @param callback - Transaction-scoped work; unused without a database.
   * @returns A rejected promise naming the missing configuration.
   */
  tx<T>(callback: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>> {
    void callback
    return Promise.reject(new Error('No database is configured for this server'))
  }
}

/**
 * Resolve the stable per-installation managed database identity.
 *
 * The normalized application working/checkout directory is the only identity
 * input; service names and asset roots do not move the database.
 * @param installation - The application working/checkout directory.
 * @returns The hashed managed database identity.
 */
export function managedDatabaseIdentity(installation: string): string {
  return createHash('sha1').update(resolve(installation)).digest('hex').slice(0, 16)
}

/**
 * A managed local PostgreSQL service and its pool.
 *
 * Its container, data volume, and host-only password file persist
 * independently of the web server process: this capability only owns the Bun
 * pool, never the database service lifecycle.
 */
class ManagedDatabase implements Database {
  #closed = false
  #closing: Promise<void> | null = null
  #connecting: Promise<void> | null = null
  #containerName: string
  #database: PostgresDatabase | null = null
  #entities: EntityDefinitions | undefined
  #identity: string
  #installation: string
  #volume: string

  /**
   * Creates the managed database capability. The service starts on {@link connect}.
   * @param entities - Canonical definitions used for entity queries.
   */
  constructor(entities?: EntityDefinitions) {
    this.#entities = entities
    this.#installation = resolve(process.cwd())
    this.#identity = managedDatabaseIdentity(this.#installation)
    this.#containerName = `basis-postgres-${this.#identity}`
    this.#volume = this.#containerName
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
   * @returns The connected pool's Bun SQL instance.
   * @throws {Error} Before the managed database is connected or after close.
   */
  get sql(): SQL {
    if (!this.#database) throw new Error('Managed database is not connected')
    return this.#database.sql
  }

  /**
   * Projects root scalar fields from one entity.
   * @param entity - Exact canonical entity name.
   * @param options - Fields to project.
   * @returns The selected rows.
   * @throws {Error} When the managed pool is not connected or the query is invalid.
   */
  query<T = Record<string, unknown>>(entity: string, options: QueryOptions): Promise<T[]> {
    if (!this.#database) return Promise.reject(new Error('Managed database is not connected'))
    return this.#database.query<T>(entity, options)
  }

  /**
   * Runs a callback inside a pooled Bun transaction.
   * @param callback - Transaction-scoped work.
   * @returns The callback result after commit.
   * @throws {Error} When the managed pool is not connected or the callback fails.
   */
  tx<T>(callback: SQL.TransactionContextCallback<T>): Promise<SQL.ContextCallbackResult<T>> {
    if (!this.#database) return Promise.reject(new Error('Managed database is not connected'))
    return this.#database.tx(callback)
  }

  /**
   * Reconciles the managed service, then connects this process's pool.
   * @returns A promise that resolves once PostgreSQL is ready.
   * @throws {Error} When Docker is missing, the service fails, or the pool closes.
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
   * Closes only this process's pool. The managed service and its data persist.
   * @returns A promise that resolves when teardown finishes.
   */
  close(): Promise<void> {
    if (!this.#closing) {
      this.#closed = true
      this.#closing = this.#stop()
    }
    return this.#closing
  }

  /** Reconciles the service, discovers its port, and connects the pool. */
  async #start(): Promise<void> {
    if (!Bun.which('docker')) throw new Error(DOCKER_REQUIRED)
    const state = await this.#containerState()
    const hasVolume = await this.#volumeExists()
    const secret = await this.#secret(state === 'missing' && !hasVolume)
    if (!hasVolume) await this.#createVolume()

    if (state === 'missing') {
      await this.#createContainer(secret.file)
    } else if (state === 'stopped') {
      const started = await runAsync`docker start ${this.#containerName}`
      if (started.exitCode !== 0) {
        const detail = started.stderr.trim() || `docker start exited with ${started.exitCode}`
        throw new Error(`PostgreSQL service failed to start: ${detail}`)
      }
    }

    const port = await this.#publishedPort()
    const url = `postgres://${MANAGED_NAME}:${encodeURIComponent(secret.password)}` +
      `@127.0.0.1:${port}/${MANAGED_NAME}`
    await this.#connectWhenReady(url)
  }

  /**
   * Ensure Git never stages the installation's database state.
   * @param directory - The installation-local `.basis/database` directory.
   */
  async #protectState(directory: string): Promise<void> {
    const ignore = join(directory, '.gitignore')
    try {
      const handle = await open(ignore, 'wx', 0o644)
      try {
        await handle.writeFile('*\n')
      } finally {
        await handle.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  /**
   * Resolve the persistent password file, creating it only for a new service.
   * @param create - Whether a missing file may be initialized.
   * @returns The password and its host file path.
   */
  async #secret(create: boolean): Promise<{ file: string, password: string }> {
    const stateRoot = join(this.#installation, '.basis')
    const directory = join(stateRoot, 'database')
    await mkdir(stateRoot, { mode: 0o700, recursive: true })
    await chmod(stateRoot, 0o700)
    await mkdir(directory, { mode: 0o700, recursive: true })
    await chmod(directory, 0o700)
    await this.#protectState(directory)
    const file = join(directory, 'password')

    if (create) {
      try {
        const handle = await open(file, 'wx', 0o600)
        try {
          await handle.writeFile(randomUUID())
        } finally {
          await handle.close()
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }

    let password: string
    try {
      password = (await readFile(file, 'utf8')).trim()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `Managed database credentials are missing for "${this.#identity}"; ` +
          'restore the password file or deprovision the database explicitly.',
          { cause: error },
        )
      }
      throw error
    }
    if (!password) throw new Error('Managed database credentials are empty')
    await chmod(file, 0o600)
    return { file, password }
  }

  /**
   * Observe the stable container without mutating it.
   * @returns Its running state, or `missing`.
   */
  async #containerState(): Promise<ContainerState> {
    const result = await runAsync`
      docker ps -a
      --filter ${`name=^/${this.#containerName}$`}
      --format {{.State}}
    `
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || `docker ps exited with ${result.exitCode}`
      throw new Error(`PostgreSQL service discovery failed: ${detail}`)
    }
    if (result.lines.length === 0) return 'missing'
    return result.lines[0] === 'running' ? 'running' : 'stopped'
  }

  /**
   * Whether the durable data volume exists.
   * @returns `true` when Docker knows the volume.
   */
  async #volumeExists(): Promise<boolean> {
    const result = await runAsync`
      docker volume ls -q --filter ${`name=^${this.#volume}$`}
    `
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || `docker volume ls exited with ${result.exitCode}`
      throw new Error(`PostgreSQL volume discovery failed: ${detail}`)
    }
    return result.lines.length > 0
  }

  /** Create the durable data volume with application ownership labels. */
  async #createVolume(): Promise<void> {
    const created = await runAsync`
      docker volume create
      --label ${`basis.database=${this.#identity}`}
      --label ${`basis.install=${this.#installation}`}
      ${this.#volume}
    `
    if (created.exitCode !== 0) {
      const detail = created.stderr.trim() || `docker volume create exited with ${created.exitCode}`
      throw new Error(`PostgreSQL data volume failed to start: ${detail}`)
    }
  }

  /**
   * Create the managed service without replacing a healthy existing one.
   * @param passwordFile - Host path mounted as the PostgreSQL password file.
   */
  async #createContainer(passwordFile: string): Promise<void> {
    const run = await runAsync`
      docker run -d --pull missing
      --name ${this.#containerName}
      --label ${`basis.database=${this.#identity}`}
      --label ${`basis.install=${this.#installation}`}
      -e ${`POSTGRES_USER=${MANAGED_NAME}`}
      -e ${`POSTGRES_PASSWORD_FILE=${PASSWORD_MOUNT}`}
      -e ${`POSTGRES_DB=${MANAGED_NAME}`}
      -v ${`${this.#volume}:/var/lib/postgresql/data`}
      -v ${`${passwordFile}:${PASSWORD_MOUNT}:ro`}
      -p ${`127.0.0.1::${MANAGED_PORT}`}
      ${MANAGED_IMAGE}
    `
    if (run.exitCode === 0) return

    // Another process may have created the same app-owned service concurrently.
    const state = await this.#containerState()
    if (state === 'missing') {
      const detail = run.stderr.trim() || `docker run exited with ${run.exitCode}`
      throw new Error(`PostgreSQL service failed to start: ${detail}`)
    }
    if (state === 'stopped') {
      const started = await runAsync`docker start ${this.#containerName}`
      if (started.exitCode !== 0) {
        const detail = started.stderr.trim() || `docker start exited with ${started.exitCode}`
        throw new Error(`PostgreSQL service failed to start: ${detail}`)
      }
    }
  }

  /**
   * Discover the container's Docker-allocated loopback port.
   * @returns The published host port.
   */
  async #publishedPort(): Promise<number> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await runAsync`docker port ${this.#containerName} ${`${MANAGED_PORT}/tcp`}`
      const port = publishedPort(result.stdout)
      if (port !== null) return port
      await Bun.sleep(READY_POLL_MS)
    }
    throw new Error('PostgreSQL service did not publish a loopback port')
  }

  /**
   * Retry the real pool connection until PostgreSQL accepts it.
   * @param url - The managed PostgreSQL connection URL.
   */
  async #connectWhenReady(url: string): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    let lastError: Error | null = null

    while (Date.now() < deadline) {
      if (this.#closed) throw new Error('Database is closed')

      const database = new PostgresDatabase(url, this.#entities)
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

    const logs = await runAsync`docker logs ${this.#containerName}`
    throw new Error(
      `PostgreSQL did not accept connections within ${READY_TIMEOUT_MS}ms ` +
      `(${lastError?.message ?? 'no connection'}):\n${logs.stdout}${logs.stderr}`,
    )
  }

  /** Waits for in-flight startup, then closes only this process's pool. */
  async #stop(): Promise<void> {
    await this.#connecting?.catch(() => undefined)
    await this.#database?.close()
    this.#database = null
  }
}

/**
 * Create the database capability for a server.
 * @param options - An optional external PostgreSQL URL.
 * @returns The managed or external database capability.
 */
export function createDatabase(options: DatabaseOptions = {}): Database {
  if (options.url) return new PostgresDatabase(options.url, options.entities)
  return new ManagedDatabase(options.entities)
}
