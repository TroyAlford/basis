import { runAsync } from 'basis/configuration'
import type { TransactionSQL } from 'bun'
import { SQL } from 'bun'
import { currentActor } from './ActorContext'
import type { EntityDefinitions } from './EntityDefinitions'
import { ManagedPostgresService } from './ManagedPostgresService'
import type { CreateResult, DeleteResult, EditResult, MutationDatabase, MutationFilter, MutationValues, UpsertResult } from './Mutation'
import { mutationRunner } from './Mutation'
import { compilePolymorphicQuery } from './PolymorphicQuery'
import type { Filter } from './Predicate'
export { managedDatabaseIdentity } from './ManagedPostgresService'
import type { OrderBy } from './SQL'

/** A transaction-scoped SQL client with the Graph mutation vocabulary. */
export type DatabaseTransaction = TransactionSQL & MutationDatabase

/** The pool defaults used by the managed PostgreSQL connection. */
const POOL_DEFAULTS = {
  connectionTimeout: 10,
  idleTimeout: 30,
  max: 10,
}

/** How long to wait for the managed container to accept connections. */
const READY_TIMEOUT_MS = 60_000
/** How often to poll the managed container's readiness. */
const READY_POLL_MS = 200

/** One narrow privileged provisioning connection. */
export interface AdminConnection {
  /** Closes the privileged connection. */
  close(): Promise<void>,
  /** The privileged connection's SQL capability. */
  readonly sql: SQL,
}

/** Options for a server-owned database capability. */
export interface DatabaseOptions {
  /** Managed PostgreSQL image; defaults to `postgres:17-alpine`. */
  image?: string,
}

/** Internal options used only when the server wires a canonical Graph into the managed database. */
export interface ManagedDatabaseOptions extends DatabaseOptions {
  /** Enable restricted application-role provisioning and RLS-ready operation. */
  authorization?: boolean,
  /** Canonical entity definitions owned by the application Graph. */
  entities?: EntityDefinitions,
}

/** Options for a root entity query. */
export interface QueryOptions {
  /** Per-collection preview and pagination overrides. */
  collections?: Readonly<Record<string, {
    readonly limit?: number,
    readonly offset?: number,
    readonly relationshipFields?: readonly string[],
  }>>,
  /** Effective scalar, scalar-array, JSON, collection, or singular-reference paths to project. */
  fields: readonly string[],
  /** Maximum rows to return; defaults to 25, or `null` for unlimited. */
  limit?: number | null,
  /** Rows to skip; defaults to 0. */
  offset?: number,
  /** Explicit root-field ordering, single or multi-level. */
  orderBy?: OrderBy,
  /** Single-field equality shorthand, explicit filter tree, or string query expression. */
  where?: Filter | Readonly<Record<string, unknown>> | string,
}

/** A compiled entity query and its ordered parameter values. */
export interface CompiledEntityQuery {
  /** Complete SQL statement. */
  readonly sql: string,
  /** Values bound to `$1`, `$2`, … in order. */
  readonly values: readonly unknown[],
}

/** A prepared query. */
interface PreparedEntityQuery {
  /** Convert one flat SQL row into the requested nested projection. */
  readonly hydrate: (row: Record<string, unknown>) => Record<string, unknown>,
  /** Complete SQL statement and ordered bindings. */
  readonly query: CompiledEntityQuery,
}

/**
 * Compile one entity query without executing it.
 * @param entities - Canonical entity definitions.
 * @param entity - Exact canonical entity name.
 * @param options - Query options.
 * @returns The complete SQL and ordered bindings.
 * @throws {Error} When the entity or query is invalid.
 */
export function compileEntityQuery(
  entities: EntityDefinitions,
  entity: string,
  options: QueryOptions,
): CompiledEntityQuery {
  return prepareEntityQuery(entities, entity, options).query
}

/**
 * Prepare one entity query for execution.
 * @param entities - Canonical entity definitions.
 * @param entity - Exact canonical entity name.
 * @param options - Query options.
 * @returns The compiled query and hydration metadata.
 */
function prepareEntityQuery(
  entities: EntityDefinitions,
  entity: string,
  options: QueryOptions,
): PreparedEntityQuery {
  const definition = entities.entity(entity)
  if (!definition) throw new Error(`Unknown entity "${entity}"`)
  const compiled = compilePolymorphicQuery(entities, definition, options)
  return {
    hydrate: compiled.hydrate,
    query: { sql: compiled.sql, values: compiled.values },
  }
}

/**
 * Execute one entity query through a specific Bun SQL client.
 *
 * The caller owns connection lifecycle and transaction scope; this helper owns
 * model validation, SQL construction, execution, and hydration.
 * @param sql - Connected SQL client, including a transaction-scoped client.
 * @param entities - Canonical entity definitions.
 * @param entity - Exact canonical entity name.
 * @param options - Query options.
 * @returns The selected rows.
 * @throws {Error} When the entity or query is invalid.
 */
export async function queryEntity<T = Record<string, unknown>>(
  sql: SQL,
  entities: EntityDefinitions,
  entity: string,
  options: QueryOptions,
): Promise<T[]> {
  const prepared = prepareEntityQuery(entities, entity, options)
  const rows = await sql.unsafe<Record<string, unknown>[]>(
    prepared.query.sql,
    [...prepared.query.values],
  )
  return rows.map(row => prepared.hydrate(row)) as T[]
}

const ADMIN_CONNECTIONS = new WeakMap<object, () => Promise<AdminConnection>>()

/**
 * Open the explicit privileged provisioning connection registered for a database.
 * @param database - The restricted database capability.
 * @returns A short-lived administrative connection.
 * @throws {Error} When the database has no trusted provisioner.
 */
export async function openAdmin(database: Database): Promise<AdminConnection> {
  const opener = ADMIN_CONNECTIONS.get(database)
  if (!opener) throw new Error('No administrative database connection is configured')
  return opener()
}

/** A server-owned database capability. */
export interface Database extends MutationDatabase {
  /** Closes the database pool and releases its resources. */
  close(): Promise<void>,
  /** Whether the pool has been closed. */
  readonly closed: boolean,
  /** Establishes the database pool's connection. */
  connect(): Promise<void>,
  /**
   * Creates one entity or a finite batch atomically.
   * @param entity - Exact concrete entity name.
   * @param values - One value object or finite iterable.
   * @returns The created count.
   */
  create(entity: string, values: MutationValues | Iterable<MutationValues>): Promise<CreateResult>,
  /**
   * Deletes every actor-authorized match.
   * @param entity - Entity or abstract ancestor name.
   * @param filter - Existing filter form.
   * @returns The deleted count.
   */
  delete(entity: string, filter: MutationFilter): Promise<DeleteResult>,
  /**
   * Patches every actor-authorized match.
   * @param entity - Entity or abstract ancestor name.
   * @param filter - Existing filter form.
   * @param changes - Field values to patch.
   * @returns The edited count.
   */
  edit(entity: string, filter: MutationFilter, changes: MutationValues): Promise<EditResult>,
  /** Projects effective scalar and singular reference paths from one canonical entity. */
  query<T = Record<string, unknown>>(entity: string, options: QueryOptions): Promise<T[]>,
  /** The pooled Bun SQL tagged-template API. */
  readonly sql: SQL,
  /**
   * Runs a callback inside one pooled Bun transaction.
   * @param callback - Transaction-scoped work with native SQL and mutation verbs.
   * @returns The callback result after commit.
   */
  tx<T>(callback: (tx: DatabaseTransaction) => T | Promise<T>): Promise<SQL.ContextCallbackResult<T>>,
  /**
   * Edits exactly one authorized match or creates one.
   * @param entity - Exact concrete entity name.
   * @param filter - Existing filter form.
   * @param values - Values used by either branch.
   * @returns Which branch ran.
   */
  upsert(entity: string, filter: MutationFilter, values: MutationValues): Promise<UpsertResult>,
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
   * Create one entity or a finite batch atomically.
   * @param entity - Exact concrete entity name.
   * @param values - One value object or finite iterable.
   * @returns The created count.
   */
  create(entity: string, values: MutationValues | Iterable<MutationValues>): Promise<CreateResult> {
    return this.#mutate(transaction => transaction.create(entity, values))
  }

  /**
   * Delete every actor-authorized match.
   * @param entity - Entity or abstract ancestor name.
   * @param filter - Existing filter form.
   * @returns The deleted count.
   */
  delete(entity: string, filter: MutationFilter): Promise<DeleteResult> {
    return this.#mutate(transaction => transaction.delete(entity, filter))
  }

  /**
   * Patch every actor-authorized match.
   * @param entity - Entity or abstract ancestor name.
   * @param filter - Existing filter form.
   * @param changes - Field values to patch.
   * @returns The edited count.
   */
  edit(entity: string, filter: MutationFilter, changes: MutationValues): Promise<EditResult> {
    return this.#mutate(transaction => transaction.edit(entity, filter, changes))
  }

  /**
   * Project effective scalar and singular reference paths from one entity.
   * @param entity - Exact canonical entity name.
   * @param options - Scalar fields and singular reference paths to project.
   * @returns The selected rows.
   * @throws {Error} When no definitions are configured, the pool is closed, or the query is invalid.
   */
  async query<T = Record<string, unknown>>(entity: string, options: QueryOptions): Promise<T[]> {
    if (this.#closed) throw new Error('Database is closed')
    if (!this.#entities) throw new Error('No entity definitions are configured for this database')
    return this.tx(async tx => queryEntity<T>(tx, this.#entities as EntityDefinitions, entity, options))
  }

  /**
   * Runs a callback inside a Bun transaction on this pool.
   * @param callback - Transaction-scoped work with native SQL and mutation verbs.
   * @returns The callback result after commit.
   * @throws {Error} When the pool is closed or the callback fails.
   */
  tx<T>(callback: (tx: DatabaseTransaction) => T | Promise<T>): Promise<SQL.ContextCallbackResult<T>> {
    if (this.#closed) return Promise.reject(new Error('Database is closed'))
    return this.#sql.begin(async tx => {
      const actor = currentActor()
      await tx`select set_config('actor.id', ${actor?.id ?? ''}, true)`
      return callback(this.#transaction(tx))
    })
  }

  /**
   * Edit exactly one authorized match or create one.
   * @param entity - Exact concrete entity name.
   * @param filter - Existing filter form.
   * @param values - Values used by either branch.
   * @returns Which branch ran.
   */
  upsert(entity: string, filter: MutationFilter, values: MutationValues): Promise<UpsertResult> {
    return this.#mutate(transaction => transaction.upsert(entity, filter, values))
  }

  /**
   * Run one mutation through the standard pooled transaction boundary.
   * @param work - Mutation work.
   * @returns The mutation result.
   */
  #mutate<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.tx(work)
  }

  /**
   * Attach mutation verbs to one native transaction client.
   * @param tx - Bun transaction client.
   * @returns The same transaction with mutation verbs.
   */
  #transaction(tx: TransactionSQL): DatabaseTransaction {
    return transactionWithMutations(this.#entities, tx)
  }
}

/**
 * Attach the Graph mutation vocabulary to one native Bun transaction client.
 * @param entities - Canonical definitions, or undefined when unconfigured.
 * @param tx - Bun transaction client.
 * @returns The same transaction with mutation verbs.
 */
export function transactionWithMutations(
  entities: EntityDefinitions | undefined,
  tx: TransactionSQL,
): DatabaseTransaction {
  if (!entities) {
    return new Proxy(tx, {
      apply: (target, _thisArg, args) => Reflect.apply(target, target, args),
      get: (target, property, receiver) => {
        if (property === 'create' || property === 'delete' || property === 'edit' || property === 'upsert') {
          return () => Promise.reject(new Error('No entity definitions are configured for this database'))
        }
        return boundTransactionMember(target, property, receiver)
      },
    }) as DatabaseTransaction
  }
  const mutations = mutationRunner(entities, tx)
  return new Proxy(tx, {
    apply: (target, _thisArg, args) => Reflect.apply(target, target, args),
    get: (target, property, receiver) => {
      if (property === 'create') return mutations.create
      if (property === 'delete') return mutations.delete
      if (property === 'edit') return mutations.edit
      if (property === 'upsert') return mutations.upsert
      return boundTransactionMember(target, property, receiver)
    },
  }) as DatabaseTransaction
}

/**
 * Preserve native transaction member binding through the mutation proxy.
 * @param target - Native transaction client.
 * @param property - Requested member.
 * @param receiver - Proxy receiver.
 * @returns The member value or bound function.
 */
function boundTransactionMember(
  target: TransactionSQL,
  property: string | symbol,
  receiver: unknown,
): unknown {
  const value = Reflect.get(target, property, receiver)
  return typeof value === 'function' ? value.bind(target) : value
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
   * @param values - Mutation values; unused without a database.
   * @returns A rejected promise naming the missing configuration.
   */
  create(entity: string, values: MutationValues | Iterable<MutationValues>): Promise<CreateResult> {
    void entity
    void values
    return Promise.reject(new Error('No database is configured for this server'))
  }

  /**
   * Rejects because no database is configured.
   * @param entity - Entity name; unused without a database.
   * @param filter - Mutation filter; unused without a database.
   * @returns A rejected promise naming the missing configuration.
   */
  delete(entity: string, filter: MutationFilter): Promise<DeleteResult> {
    void entity
    void filter
    return Promise.reject(new Error('No database is configured for this server'))
  }

  /**
   * Rejects because no database is configured.
   * @param entity - Entity name; unused without a database.
   * @param filter - Mutation filter; unused without a database.
   * @param changes - Mutation changes; unused without a database.
   * @returns A rejected promise naming the missing configuration.
   */
  edit(entity: string, filter: MutationFilter, changes: MutationValues): Promise<EditResult> {
    void entity
    void filter
    void changes
    return Promise.reject(new Error('No database is configured for this server'))
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
  tx<T>(callback: (tx: DatabaseTransaction) => T | Promise<T>): Promise<SQL.ContextCallbackResult<T>> {
    void callback
    return Promise.reject(new Error('No database is configured for this server'))
  }

  /**
   * Rejects because no database is configured.
   * @param entity - Entity name; unused without a database.
   * @param filter - Mutation filter; unused without a database.
   * @param values - Mutation values; unused without a database.
   * @returns A rejected promise naming the missing configuration.
   */
  upsert(
    entity: string,
    filter: MutationFilter,
    values: MutationValues,
  ): Promise<UpsertResult> {
    void entity
    void filter
    void values
    return Promise.reject(new Error('No database is configured for this server'))
  }
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
  #authorization: boolean
  #database: PostgresDatabase | null = null
  #entities: EntityDefinitions | undefined
  #service: ManagedPostgresService

  /**
   * Creates the managed database capability. The service starts on {@link connect}.
   * @param entities - Canonical definitions used for entity queries.
   * @param authorization - Whether to provision and use a restricted app role.
   * @param image - Managed PostgreSQL image.
   */
  constructor(entities?: EntityDefinitions, authorization = false, image?: string) {
    this.#authorization = authorization
    this.#entities = entities
    this.#service = new ManagedPostgresService({ image })
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
   * Create one entity or a finite batch atomically.
   * @param entity - Exact concrete entity name.
   * @param values - One value object or finite iterable.
   * @returns The created count.
   */
  create(entity: string, values: MutationValues | Iterable<MutationValues>): Promise<CreateResult> {
    if (!this.#database) return Promise.reject(new Error('Managed database is not connected'))
    return this.#database.create(entity, values)
  }

  /**
   * Delete every actor-authorized match.
   * @param entity - Entity or abstract ancestor name.
   * @param filter - Existing filter form.
   * @returns The deleted count.
   */
  delete(entity: string, filter: MutationFilter): Promise<DeleteResult> {
    if (!this.#database) return Promise.reject(new Error('Managed database is not connected'))
    return this.#database.delete(entity, filter)
  }

  /**
   * Patch every actor-authorized match.
   * @param entity - Entity or abstract ancestor name.
   * @param filter - Existing filter form.
   * @param changes - Field values to patch.
   * @returns The edited count.
   */
  edit(entity: string, filter: MutationFilter, changes: MutationValues): Promise<EditResult> {
    if (!this.#database) return Promise.reject(new Error('Managed database is not connected'))
    return this.#database.edit(entity, filter, changes)
  }

  /**
   * Project effective scalar and singular reference paths from one entity.
   * @param entity - Exact canonical entity name.
   * @param options - Scalar fields and singular reference paths to project.
   * @returns The selected rows.
   * @throws {Error} When the managed pool is not connected or the query is invalid.
   */
  query<T = Record<string, unknown>>(entity: string, options: QueryOptions): Promise<T[]> {
    if (!this.#database) return Promise.reject(new Error('Managed database is not connected'))
    return this.#database.query<T>(entity, options)
  }

  /**
   * Runs a callback inside a pooled Bun transaction.
   * @param callback - Transaction-scoped work with native SQL and mutation verbs.
   * @returns The callback result after commit.
   * @throws {Error} When the managed pool is not connected or the callback fails.
   */
  tx<T>(callback: (tx: DatabaseTransaction) => T | Promise<T>): Promise<SQL.ContextCallbackResult<T>> {
    if (!this.#database) return Promise.reject(new Error('Managed database is not connected'))
    return this.#database.tx(callback)
  }

  /**
   * Edit exactly one authorized match or create one.
   * @param entity - Exact concrete entity name.
   * @param filter - Existing filter form.
   * @param values - Values used by either branch.
   * @returns Which branch ran.
   */
  upsert(entity: string, filter: MutationFilter, values: MutationValues): Promise<UpsertResult> {
    if (!this.#database) return Promise.reject(new Error('Managed database is not connected'))
    return this.#database.upsert(entity, filter, values)
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
    const { appUrl, ownerUrl } = await this.#service.ensure(this.#authorization)
    ADMIN_CONNECTIONS.set(this, async () => {
      const pool = new PostgresDatabase(ownerUrl)
      await pool.connect()
      return { close: () => pool.close(), sql: pool.sql }
    })
    await this.#connectWhenReady(this.#authorization ? appUrl as string : ownerUrl)
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

    const logs = await runAsync`docker logs ${this.#service.containerName}`
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
 * Create the one managed database capability for a server.
 * @param options - Internal Graph-derived configuration and optional image.
 * @returns The managed database capability.
 */
export function createDatabase(options: ManagedDatabaseOptions = {}): Database {
  return new ManagedDatabase(options.entities, options.authorization ?? false, options.image)
}
