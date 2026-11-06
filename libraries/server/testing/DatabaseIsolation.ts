import type { SQL as BunSQL } from 'bun'
import { randomUUID } from 'node:crypto'
import type { QueryOptions } from '../source/Database'
import { queryEntity } from '../source/Database'
import type { EntityDefinitions } from '../source/EntityDefinitions'
import { useDatabaseFixture } from './DatabaseFixture'

/** A connection owned by one isolated database test. */
type ReservedSQL = Awaited<ReturnType<BunSQL['reserve']>>

/** A transaction-bound database used by an ordinary isolated test. */
export interface IsolatedDatabase {
  /**
   * Run a callback that is expected to fail, recovering through a savepoint.
   * @param work - Operation expected to throw.
   * @returns The thrown error.
   * @throws {Error} When the operation succeeds or a savepoint operation fails.
   */
  captureError(work: (database: IsolatedDatabase) => Promise<unknown>): Promise<unknown>,
  /** Shared entity definitions attached to the fixture. */
  readonly entities: EntityDefinitions,
  /**
   * Project effective scalar and singular reference paths through the test transaction.
   * @param entity - Exact canonical entity name.
   * @param options - Query options.
   * @returns The selected rows.
   */
  query<T = Record<string, unknown>>(entity: string, options: QueryOptions): Promise<T[]>,
  /** Schema selected by this test transaction. */
  readonly schema: string,
  /** The transaction-bound Bun SQL client. */
  readonly sql: BunSQL,
  /** Select a cached schema for one exact entity definition set. */
  use(entities: EntityDefinitions): Promise<void>,
}

/** A committed, unique schema used by a cross-transaction test. */
export interface DurableDatabase {
  /** Shared entity definitions attached to the fixture. */
  readonly entities: EntityDefinitions,
  /**
   * Project effective scalar and singular reference paths in a schema-scoped transaction.
   * @param entity - Exact canonical entity name.
   * @param options - Query options.
   * @returns The selected rows.
   */
  query<T = Record<string, unknown>>(entity: string, options: QueryOptions): Promise<T[]>,
  /** Unique schema owned by this test. */
  readonly schema: string,
  /**
   * Run a schema-scoped transaction on the shared production pool.
   * @param callback - Transaction-scoped work.
   * @returns The callback result after commit.
   */
  tx<T>(callback: BunSQL.TransactionContextCallback<T>): Promise<BunSQL.ContextCallbackResult<T>>,
}

/** Saved savepoint name prefix. */
const SAVEPOINT_PREFIX = 'basis_test_savepoint_'

/** Options for one isolated database test. */
export interface IsolatedDatabaseOptions {
  /** Allocate a unique schema instead of using the cached fixture schema. */
  readonly fresh?: boolean,
}

/**
 * Run an ordinary database test inside one transaction.
 *
 * The default path uses a pre-migrated fixture schema and rolls every test back.
 * `fresh` allocates a unique schema for tests that intentionally exercise
 * schema creation, rollback, or concurrent schema ownership.
 * @param label - Fixture acquisition label.
 * @param callback - Test work using the isolated database.
 * @param options - Isolation options.
 * @returns The callback result.
 */
export async function withIsolatedDatabase<T>(
  label: string,
  callback: (database: IsolatedDatabase) => Promise<T>,
  options: IsolatedDatabaseOptions = {},
): Promise<T> {
  const fixture = await useDatabaseFixture(label)
  const schema = options.fresh ? schemaName() : await fixture.schemaFor(fixture.entities)
  const reserved = await fixture.server.db.sql.reserve()
  let transactionStarted = false
  try {
    await reserved.unsafe('begin').simple()
    transactionStarted = true
    if (options.fresh) {
      await reserved.unsafe(`create schema ${quoteIdentifier(schema)}`).simple()
    }
    await setSearchPath(reserved, schema)
    return await callback(new IsolatedDatabaseContext(
      reserved,
      fixture.entities,
      schema,
      fixture.schemaFor,
    ))
  } finally {
    try {
      if (transactionStarted) await reserved.unsafe('rollback').simple()
    } finally {
      reserved.release()
    }
  }
}

/**
 * Run a cross-transaction database test in a committed unique schema.
 *
 * The schema is dropped after the callback, including when it fails, so
 * committed resources cannot leak while commit/rollback semantics stay real.
 * @param label - Fixture acquisition label.
 * @param callback - Test work using the durable database.
 * @returns The callback result.
 */
export async function withDurableDatabase<T>(
  label: string,
  callback: (database: DurableDatabase) => Promise<T>,
): Promise<T> {
  const fixture = await useDatabaseFixture(label)
  const schema = schemaName()
  await fixture.server.db.sql.unsafe(`create schema ${quoteIdentifier(schema)}`).simple()

  const transaction = <Result>(work: BunSQL.TransactionContextCallback<Result>) => (
    fixture.server.db.tx(async sql => {
      await setSearchPath(sql, schema)
      return await work(sql)
    })
  )

  const database: DurableDatabase = {
    entities: fixture.entities,
    query: async <Result = Record<string, unknown>>(entity: string, options: QueryOptions) => (
      transaction(tx => queryEntity<Result>(tx, fixture.entities, entity, options))
    ),
    schema,
    tx: transaction,
  }

  const cleanup = async (): Promise<void> => {
    await fixture.server.db.sql.unsafe(`drop schema if exists ${quoteIdentifier(schema)} cascade`).simple()
    const remaining = await fixture.server.db.sql<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schema} ) AS present
    `
    if (remaining[0]?.present) throw new Error(`Database test schema "${schema}" was not removed`)
  }

  let result!: T
  try {
    result = await callback(database)
  } catch (error) {
    try {
      await cleanup()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Durable database test and cleanup failed',
        { cause: cleanupError },
      )
    }
    throw error
  }

  await cleanup()
  return result
}

/** A transaction-bound isolated database context. */
class IsolatedDatabaseContext implements IsolatedDatabase {
  #savepoint = 0
  #schema: string

  /**
   * Create a transaction-bound context.
   * @param connection - Reserved connection in a transaction.
   * @param entities - Shared entity definitions.
   * @param schema - Selected schema name.
   * @param schemaFor - Cached schema resolver.
   */
  constructor(
    private readonly connection: ReservedSQL,
    readonly entities: EntityDefinitions,
    schema: string,
    private readonly schemaFor: (entities: EntityDefinitions) => Promise<string>,
  ) {
    this.#schema = schema
  }

  /**
   * The transaction-bound SQL client.
   * @returns The reserved SQL client.
   */
  get sql(): BunSQL {
    return this.connection
  }

  /**
   * The currently selected schema.
   * @returns The schema name.
   */
  get schema(): string {
    return this.#schema
  }

  /**
   * Select the cached schema for one exact entity definition set.
   * @param entities - Canonical definitions.
   */
  async use(entities: EntityDefinitions): Promise<void> {
    const schema = await this.schemaFor(entities)
    if (schema === this.#schema) return
    await setSearchPath(this.connection, schema)
    this.#schema = schema
  }

  /**
   * Run an expected failure and recover the transaction through a savepoint.
   * @param work - Operation expected to throw.
   * @returns The thrown error.
   */
  async captureError(work: (database: IsolatedDatabase) => Promise<unknown>): Promise<unknown> {
    const name = `${SAVEPOINT_PREFIX}${this.#savepoint}`
    this.#savepoint += 1
    await this.connection.unsafe(`savepoint ${quoteIdentifier(name)}`).simple()
    try {
      await work(this)
    } catch (error) {
      await this.connection.unsafe(`rollback to savepoint ${quoteIdentifier(name)}`).simple()
      await this.connection.unsafe(`release savepoint ${quoteIdentifier(name)}`).simple()
      return error
    }
    await this.connection.unsafe(`release savepoint ${quoteIdentifier(name)}`).simple()
    throw new Error('Expected isolated database operation to fail')
  }

  /**
   * Project effective scalar and singular reference paths through the transaction.
   * @param entity - Exact canonical entity name.
   * @param options - Query options.
   * @returns The selected rows.
   */
  query<T = Record<string, unknown>>(entity: string, options: QueryOptions): Promise<T[]> {
    return queryEntity<T>(this.connection, this.entities, entity, options)
  }
}

/**
 * Create a unique per-test schema name.
 * @returns A safe schema identifier.
 */
function schemaName(): string {
  return `basis_test_${randomUUID().replaceAll('-', '')}`
}

/**
 * Set the transaction-local search path to one test schema.
 * @param sql - Transaction-scoped SQL client.
 * @param schema - Unique schema name.
 */
async function setSearchPath(sql: BunSQL, schema: string): Promise<void> {
  await sql.unsafe(`set local search_path to ${quoteIdentifier(schema)}`).simple()
}

/**
 * Quote a generated PostgreSQL identifier.
 * @param identifier - Safe generated identifier.
 * @returns The quoted identifier.
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
