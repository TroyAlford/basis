import type { SQL as BunSQL } from 'bun'
import { randomUUID } from 'node:crypto'
import type { QueryOptions } from '../source/Database'
import { queryEntity } from '../source/Database'
import type { EntityDefinitions } from '../source/EntityDefinitions'
import type { MutationDatabase, MutationFilter, MutationValues } from '../source/Mutation'
import { mutationRunner } from '../source/Mutation'
import { useDatabaseFixture } from './DatabaseFixture'

/** A connection owned by one isolated database test. */
type ReservedSQL = Awaited<ReturnType<BunSQL['reserve']>>

/** A transaction-bound database used by an ordinary isolated test. */
export interface LifecycleDatabase extends MutationDatabase {
  /**
   * Run a callback that is expected to fail, recovering through a savepoint.
   * @param work - Operation expected to throw.
   * @returns The thrown error.
   * @throws {Error} When the operation succeeds or a savepoint operation fails.
   */
  captureError(work: (database: LifecycleDatabase) => Promise<unknown>): Promise<unknown>,
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

/** Saved savepoint name prefix. */
const SAVEPOINT_PREFIX = 'basis_test_savepoint_'

/** Options for one lifecycle-backed rollback database test. */
export interface LifecycleDatabaseOptions {
  /** Entity definitions to prepare and query; defaults to the fixture's shared model. */
  readonly entities?: EntityDefinitions,
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
export async function withLifecycleDatabase<T>(
  label: string,
  callback: (database: LifecycleDatabase) => Promise<T>,
  options: LifecycleDatabaseOptions = {},
): Promise<T> {
  const fixture = await useDatabaseFixture(label)
  const entities = options.entities ?? fixture.entities
  const schema = options.fresh ? schemaName() : await fixture.schemaFor(entities)
  const reserved = await fixture.database.sql.reserve()
  let transactionStarted = false
  try {
    await reserved.unsafe('begin').simple()
    transactionStarted = true
    if (options.fresh) {
      await reserved.unsafe(`create schema ${quoteIdentifier(schema)}`).simple()
    }
    await setSearchPath(reserved, schema)
    return await callback(new LifecycleDatabaseContext(
      reserved,
      entities,
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

/** A transaction-bound isolated database context. */
class LifecycleDatabaseContext implements LifecycleDatabase {
  #entities: EntityDefinitions
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
    entities: EntityDefinitions,
    schema: string,
    private readonly schemaFor: (entities: EntityDefinitions) => Promise<string>,
  ) {
    this.#entities = entities
    this.#schema = schema
  }

  /**
   * The active entity definitions for this schema.
   * @returns The selected definitions.
   */
  get entities(): EntityDefinitions {
    return this.#entities
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
    if (schema !== this.#schema) {
      await setSearchPath(this.connection, schema)
      this.#schema = schema
    }
    this.#entities = entities
  }

  create(entity: string, values: MutationValues | Iterable<MutationValues>) {
    return this.#mutations().create(entity, values)
  }

  delete(entity: string, filter: MutationFilter) {
    return this.#mutations().delete(entity, filter)
  }

  edit(entity: string, filter: MutationFilter, changes: MutationValues) {
    return this.#mutations().edit(entity, filter, changes)
  }

  upsert(entity: string, filter: MutationFilter, values: MutationValues) {
    return this.#mutations().upsert(entity, filter, values)
  }

  /**
   * Build the mutation capability for the active definitions and transaction.
   * @returns The transaction-bound mutation vocabulary.
   */
  #mutations(): MutationDatabase {
    return mutationRunner(this.#entities, this.connection)
  }

  /**
   * Run an expected failure and recover the transaction through a savepoint.
   * @param work - Operation expected to throw.
   * @returns The thrown error.
   */
  async captureError(work: (database: LifecycleDatabase) => Promise<unknown>): Promise<unknown> {
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
