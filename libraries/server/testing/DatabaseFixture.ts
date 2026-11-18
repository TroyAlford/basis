import { run, runAsync } from 'basis/utilities'
import type { TransactionSQL } from 'bun'
import { SQL as BunSQL } from 'bun'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { seedImage } from '../../../testing/database/seed/image'
import { reapDeadTestContainers, testContainerLabels } from '../../testing/containers'
import { registerRunCleanup } from '../../testing/lifecycle'
import { currentActor, runAsActor } from '../source/ActorContext'
import type { Database, DatabaseTransaction, QueryOptions } from '../source/Database'
import { queryEntity, RollbackSignal, transactionClient, transactionWithMutations } from '../source/Database'
import type { EntityDefinitions } from '../source/EntityDefinitions'
import { Constraint } from '../source/EntityDefinitions'
import { Action, Graph, Security } from '../source/Graph'
import { managedDatabaseIdentity } from '../source/ManagedPostgresService'
import type { CreateResult, DeleteResult, EditResult, MutationDatabase, MutationFilter, MutationValues, UpsertResult } from '../source/Mutation'
import { mutationRunner, validateTransactionState } from '../source/Mutation'
import { installBasis } from '../source/Schema'
import { ensureSeedImage } from './DatabaseImage'
import { installSchema } from './Schema'

/** Activity-log environment variable used by the lifecycle proof. */
const ACTIVITY_LOG = 'BASIS_DATABASE_ACTIVITY_LOG'

/** The pool defaults shared with the server database capability. */
const POOL_DEFAULTS = {
  connectionTimeout: 10,
  idleTimeout: 30,
  max: 10,
}

/** The PostgreSQL port exposed by the seeded image. */
const DATABASE_PORT = 5432

/** How often to poll container readiness. */
const READY_POLL_MS = 100

/** How long to wait for the seeded container to accept connections. */
const READY_TIMEOUT_MS = 30_000

/** The Note entity fixture used by ordinary database tests. */
export const noteDefinition = {
  fields: [
    { field: 'id', format: 'UUID' },
    { field: 'title', type: 'String' },
    { field: 'active', type: 'Boolean' },
    { field: 'score', type: 'Number' },
    { field: 'dueOn', type: 'Date' },
    { field: 'createdAt', type: 'Timestamp' },
  ],
  name: 'Note',
}

/** The Account entity fixture used by ordinary database tests. */
export const accountDefinition = {
  fields: [
    { field: 'id', format: 'Snowflake' },
    { field: 'label', type: 'String' },
  ],
  name: 'Account',
}

/** The NumberRow entity fixture used by ordinary database tests. */
export const numberRowDefinition = {
  fields: [
    { field: 'id', format: 'UUID' },
    { field: 'value', type: 'Number' },
  ],
  name: 'NumberRow',
}

/** The nullable QueryRow entity fixture used by predicate tests. */
export const queryRowDefinition = {
  fields: [
    { field: 'id', format: 'UUID' },
    { field: 'active', type: 'Boolean' },
    { field: 'externalId', type: 'Number' },
    { field: 'rank', type: 'Number' },
    { field: 'score', type: 'Number' },
    { field: 'title', type: 'String' },
  ],
  name: 'QueryRow',
}

/** The User entity used by reference-field query tests. */
export const userDefinition = {
  fields: [
    { field: 'id', format: 'UUID' },
    { field: 'label', type: 'String' },
  ],
  name: 'User',
}

/** The Article entity used by reference-field query tests. */
export const articleDefinition = {
  fields: [
    { field: 'id', format: 'UUID' },
    { field: 'title', type: 'String' },
    { field: 'owner', target: 'User', type: 'Entity' },
  ],
  name: 'Article',
}

/** Restricted role used by fixture graph policies. */
const FIXTURE_APP_ROLE = 'basis_app'
/** Single schema owned by the one fixture graph. */
const FIXTURE_SCHEMA = 'basis_fixture_v2'

/** Deterministic identities and rows seeded into the one fixture graph. */
export const fixtureRows = {
  account: '1001',
  alice: '00000000-0000-4000-8000-000000000101',
  anonymousNote: '00000000-0000-4000-8000-000000000102',
  article: '00000000-0000-4000-8000-000000000125',
  bob: '00000000-0000-4000-8000-000000000103',
  editorWorkspace: '00000000-0000-4000-8000-000000000126',
  guardedWorkspace: '00000000-0000-4000-8000-000000000113',
  hiddenWorkspace: '00000000-0000-4000-8000-000000000112',
  invalidChildDocument: '00000000-0000-4000-8000-000000000114',
  invalidParentDocument: '00000000-0000-4000-8000-000000000115',
  linkedNote: '00000000-0000-4000-8000-000000000104',
  memberNote: '00000000-0000-4000-8000-000000000105',
  note: '00000000-0000-4000-8000-000000000122',
  numberRow: '00000000-0000-4000-8000-000000000123',
  openTask: '00000000-0000-4000-8000-000000000106',
  orphanDocument: '00000000-0000-4000-8000-000000000116',
  orphanRevision: '00000000-0000-4000-8000-000000000117',
  otherTask: '00000000-0000-4000-8000-000000000107',
  ownerA: '00000000-0000-4000-8000-000000000118',
  ownerB: '00000000-0000-4000-8000-000000000119',
  project: '00000000-0000-4000-8000-000000000108',
  queryRow: '00000000-0000-4000-8000-000000000124',
  revisionA: '00000000-0000-4000-8000-000000000120',
  secondProject: '00000000-0000-4000-8000-000000000109',
  thirdProject: '00000000-0000-4000-8000-000000000110',
  validDocument: '00000000-0000-4000-8000-000000000121',
  viewerWorkspace: '00000000-0000-4000-8000-000000000127',
  visibleWorkspace: '00000000-0000-4000-8000-000000000111',
} as const

/** Explicit public access for validation fixture entities. */
const publicActions = {
  [Action.Create]: Security.Public,
  [Action.Delete]: Security.Public,
  [Action.Read]: Security.Public,
  [Action.Update]: Security.Public,
} as const

/**
 * The one canonical fixture graph.
 *
 * One seeded fixture installs this model once; graph tests reserve a transaction
 * and run as the restricted app role.
 */
const fixtureGraph = new Graph({
  entities: JSON.stringify({
    entities: [
      noteDefinition,
      accountDefinition,
      numberRowDefinition,
      queryRowDefinition,
      {
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'label', type: 'String' },
          { field: 'email', type: 'String' },
        ],
        name: 'User',
        security: { [Action.Read]: Security.Public },
      },
      {
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'title', type: 'String' },
          { field: 'owner', target: 'User', type: 'Entity' },
        ],
        name: 'Article',
      },
      {
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'label', type: 'String' },
          { field: 'email', type: 'String' },
          { field: 'favorite', target: 'Entity', type: 'Entity' },
          { field: 'manager', target: 'User', type: 'Entity' },
          { field: 'permissions', type: 'String' },
        ],
        name: 'SystemUser',
      },
      {
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'label', type: 'String' },
          { field: 'email', type: 'String' },
          { field: 'company', type: 'String' },
        ],
        name: 'Client',
      },
      {
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'label', type: 'String' },
          { field: 'email', type: 'String' },
        ],
        name: 'MtiUser',
      },
      {
        extends: 'MtiUser',
        fields: [
          { field: 'favorite', target: 'Entity', type: 'Entity' },
          { field: 'manager', target: 'MtiUser', type: 'Entity' },
          { field: 'permissions', type: 'String' },
        ],
        name: 'MtiSystemUser',
      },
      {
        extends: 'MtiUser',
        fields: [{ field: 'company', type: 'String' }],
        name: 'MtiClient',
      },
      {
        fields: [
          { field: 'id', format: 'Snowflake' },
          { field: 'title', type: 'String' },
        ],
        name: 'Book',
      },
      {
        extends: 'Book',
        fields: [{ field: 'genre', type: 'String' }],
        name: 'Novel',
      },
      {
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'car', target: 'CycleCar', type: 'Entity' },
        ],
        name: 'CycleUser',
      },
      {
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'user', target: 'CycleUser', type: 'Entity' },
        ],
        name: 'CycleCar',
      },
      {
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'parent', target: 'TreeNode', type: 'Entity' },
        ],
        name: 'TreeNode',
      },
      {
        fields: [{ field: 'title', type: 'String' }],
        name: 'AnonymousNote',
        security: { [Action.Read]: { where: '$me = null' } },
      },
      {
        fields: [{ field: 'title', type: 'String' }],
        name: 'MemberNote',
        security: { [Action.Read]: { where: '$me != null' } },
      },
      {
        fields: [
          { field: 'title', type: 'String' },
          { field: 'workspace', inverse: 'projects', target: 'Workspace', type: 'Entity' },
          {
            cardinality: 'Many',
            field: 'tasks',
            inverse: 'project',
            target: 'Task',
            type: 'Inverse',
          },
        ],
        name: 'Project',
        security: { [Action.Read]: Security.Public },
      },
      {
        fields: [
          { field: 'title', type: 'String' },
          { field: 'project', inverse: 'tasks', target: 'Project', type: 'Entity' },
        ],
        name: 'Task',
        security: { [Action.Read]: { where: 'project.workspace.members $contains (id = $me)' } },
      },
      {
        fields: [
          { field: 'title', type: 'String' },
          {
            cardinality: 'Many',
            field: 'projects',
            inverse: 'workspace',
            target: 'Project',
            type: 'Inverse',
          },
        ],
        name: 'Workspace',
        security: {
          [Action.Read]: {
            where: "$me != null $and projects $contains (title = 'visible' AND tasks $contains (title = 'open'))",
          },
        },
      },
      {
        fields: [{ field: 'label', type: 'String' }],
        name: 'Owner',
        security: publicActions,
      },
      {
        fields: [{ field: 'owner', nullable: true, target: 'Owner', type: 'Entity' }],
        name: 'Revision',
        security: publicActions,
      },
      {
        constraints: [{
          description: 'A record must remain ok.',
          name: 'recordStatus',
          type: Constraint.Validation,
          where: "status = 'ok'",
        }],
        fields: [
          { field: 'title', type: 'String' },
          { field: 'status', type: 'String' },
        ],
        name: 'Record',
        security: publicActions,
      },
      {
        constraints: [{
          description: 'A document must stay flagged.',
          name: 'documentFlag',
          type: Constraint.Validation,
          where: 'flag = true',
        }, {
          description: 'An optional revision belongs to the document owner.',
          name: 'consistentRevisionOwner',
          type: Constraint.Validation,
          where: 'revision = null OR owner = revision.owner',
        }],
        extends: 'Record',
        fields: [
          { field: 'flag', type: 'Boolean' },
          { field: 'note', type: 'String' },
          { field: 'owner', target: 'Owner', type: 'Entity' },
          { field: 'revision', nullable: true, target: 'Revision', type: 'Entity' },
        ],
        name: 'Document',
      },
      {
        fields: [
          { field: 'document', nullable: true, target: 'Document', type: 'Entity' },
          { field: 'title', type: 'String' },
        ],
        name: 'Section',
        security: publicActions,
      },
      {
        constraints: [{
          description: 'A section document belongs to the asset owner.',
          name: 'consistentSectionOwner',
          type: Constraint.Validation,
          where: 'section = null OR section.document.owner = owner',
        }],
        fields: [
          { field: 'owner', target: 'Owner', type: 'Entity' },
          { field: 'section', nullable: true, target: 'Section', type: 'Entity' },
        ],
        name: 'Asset',
        security: publicActions,
      },
      {
        constraints: [{
          description: 'An optional asset belongs to the piece owner.',
          name: 'consistentAssetOwner',
          type: Constraint.Validation,
          where: 'asset = null OR asset.owner = owner',
        }],
        fields: [
          { field: 'asset', nullable: true, target: 'Asset', type: 'Entity' },
          { field: 'owner', target: 'Owner', type: 'Entity' },
        ],
        name: 'Piece',
        security: publicActions,
      },
      {
        fields: [
          { field: 'title', type: 'String' },
          { field: 'workspace', target: 'Workspace', type: 'Entity' },
        ],
        name: 'Resource',
        security: {
          [Action.Create]: [{
            where: "workspace.members $contains (id = $me $and workspaceMembership.role = 'Owner')",
          }, {
            where: "workspace.members $contains (id = $me $and workspaceMembership.role = 'Editor')",
          }],
          [Action.Read]: Security.Public,
        },
      },
      {
        fields: [{ field: 'scores', items: { type: 'Number' }, type: 'Array' }],
        name: 'ArrayResource',
        security: {
          [Action.Create]: { where: 'scores $contains (@ >= 2)' },
          [Action.Read]: Security.Public,
        },
      },
      {
        fields: [
          { field: 'title', type: 'String' },
          { field: 'workspace', target: 'Workspace', type: 'Entity' },
        ],
        name: 'CreateRoot',
        security: {
          [Action.Create]: [{
            where: "workspace.members $contains (id = $me $and workspaceMembership.role = 'Owner')",
          }, {
            where: "workspace.members $contains (id = $me $and workspaceMembership.role = 'Editor')",
          }],
          [Action.Read]: Security.Public,
        },
      },
      {
        extends: 'CreateRoot',
        fields: [],
        name: 'CreateLeaf',
      },
      {
        extends: 'CreateRoot',
        fields: [],
        name: 'CreateSibling',
      },
      {
        constraints: [{
          description: 'A guarded workspace must remain flagged.',
          name: 'guardedFlag',
          type: Constraint.Validation,
          where: 'flag = true',
        }],
        fields: [
          { field: 'flag', type: 'Boolean' },
          { field: 'title', type: 'String' },
        ],
        name: 'GuardedWorkspace',
        security: {
          [Action.Create]: { where: '$me != null' },
          [Action.Delete]: { where: '$me = null' },
          [Action.Read]: { where: '$me != null $and members $contains (id = $me)' },
          [Action.Update]: { where: '$me != null' },
        },
      },
    ],
    relationships: [
      {
        between: [
          { field: 'workspace', inverse: 'members', target: 'GuardedWorkspace' },
          { field: 'user', inverse: 'guardedWorkspaces', target: 'User' },
        ],
        fields: [],
        name: 'GuardedMembership',
        security: publicActions,
      },
      {
        between: [
          { field: 'note', inverse: 'links', target: 'MemberNote' },
          { field: 'related', inverse: 'relatedLinks', target: 'MemberNote' },
        ],
        fields: [],
        name: 'ActorLink',
        security: { [Action.Read]: { where: '$me != null' } },
      },
      {
        between: [
          { field: 'workspace', inverse: 'members', target: 'Workspace' },
          { field: 'user', inverse: 'workspaces', target: 'User' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'WorkspaceMembership',
        security: { [Action.Read]: { role: 'admin' } },
      },
    ],
  }),
  schema: FIXTURE_SCHEMA,
})

/** The one canonical fixture model. */
export const sharedEntities = fixtureGraph.definitions

/** Schema installation options for a custom-Graph fixture. */
export interface FixtureSchemaOptions {
  /** Restricted application role whose RLS policies should be installed. */
  readonly appRole?: string,
  /** Canonical Graph whose security policies should be installed. */
  readonly graph?: Graph,
}

/** Options for a custom-Graph actor-aware database fixture. */
export interface DatabaseTestOptions {
  /** Commit an owner proof instead of rolling it back. Internal proof option. */
  readonly commit?: boolean,
  /** Entity definitions for an owner proof. Internal proof option. */
  readonly entities?: EntityDefinitions,
  /** Allocate a disposable unique schema for an owner proof. Internal proof option. */
  readonly fresh?: boolean,
  /** Consumer Graph to install with Basis's restricted fixture role. */
  readonly graph?: Graph,
  /** Run the proof through the owner role instead of the app role. Internal proof option. */
  readonly owner?: boolean,
  /** Seed or prepare data as the trusted owner before entering the app role. */
  readonly setup?: (database: DatabaseContext) => Promise<void>,
}

/** The one shared-fixture transaction context. */
export interface DatabaseContext {
  /** Switch to the owner role for explicit DDL, owner SQL, or commit proofs. */
  asOwner: <T>(work: (database: DatabaseContext) => Promise<T>) => Promise<T>,
  /** Run one expected-failure savepoint unit. */
  captureError: (work: (database: DatabaseContext) => Promise<unknown>) => Promise<unknown>,
  /** Run one Graph-native mutation; validation runs before the savepoint releases. */
  create: Database['create'],
  /** Delete through the Graph-native mutation vocabulary. */
  delete: Database['delete'],
  /** Edit through the Graph-native mutation vocabulary. */
  edit: Database['edit'],
  /** Entity definitions attached to the active context. */
  readonly entities: EntityDefinitions,
  /** Query through the canonical entity compiler under RLS. */
  query: <T = Record<string, unknown>>(entity: string, options: QueryOptions) => Promise<T[]>,
  /** Schema selected for the active context. */
  readonly schema: string,
  /** Reserved transaction connection already scoped to the app role. */
  readonly sql: DatabaseTransaction,
  /** Run one transaction-final validation unit. */
  tx: <T>(work: (transaction: DatabaseTransaction) => T | Promise<T>) => Promise<T>,
  /** Upsert through the Graph-native mutation vocabulary. */
  upsert: Database['upsert'],
  /** Select a cached schema for one exact entity definition set. */
  use(entities: EntityDefinitions): Promise<void>,
}

/** A reserved connection owned by one owner-role proof. */
type ReservedSQL = Awaited<ReturnType<BunSQL['reserve']>>

/** Saved savepoint name prefix for owner proofs. */
const OWNER_SAVEPOINT_PREFIX = 'basis_owner_savepoint_'

/**
 * Owner-role view over one reserved fixture connection.
 *
 * `sql` is autocommit until `tx` starts a transaction. `tx` always rolls back,
 * matching the ordinary test transaction's auto-rollback contract.
 */
class OwnerDatabaseContext implements DatabaseContext {
  #entities: EntityDefinitions
  #savepoint = 0
  #schema: string
  #transaction: BunSQL | null = null

  constructor(
    private readonly connection: ReservedSQL,
    schema: string,
    entities: EntityDefinitions,
    private readonly schemaFor: (entities: EntityDefinitions) => Promise<string>,
  ) {
    this.#schema = schema
    this.#entities = entities
  }

  get entities(): EntityDefinitions {
    return this.#entities
  }

  get schema(): string {
    return this.#schema
  }

  get sql(): DatabaseTransaction {
    return (this.#transaction ?? this.connection) as unknown as DatabaseTransaction
  }

  asOwner<T>(work: (database: DatabaseContext) => Promise<T>): Promise<T> {
    return work(this)
  }

  /** Begin the outer owner test transaction. */
  async begin(): Promise<void> {
    await this.connection.unsafe('begin').simple()
    this.#transaction = this.connection
    await this.connection.unsafe(
      `set local search_path to ${quoteIdentifier(this.#schema)}`,
    ).simple()
  }

  /** Roll back the outer owner test transaction. */
  async rollback(): Promise<void> {
    this.#transaction = null
    await this.connection.unsafe('rollback').simple()
  }

  /** Commit the outer owner transaction for an explicit commit proof. */
  async commit(): Promise<void> {
    this.#transaction = null
    await this.connection.unsafe('commit').simple()
  }

  async captureError(work: (database: DatabaseContext) => Promise<unknown>): Promise<unknown> {
    const name = `${OWNER_SAVEPOINT_PREFIX}${this.#savepoint}`
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
    throw new Error('Expected owner database operation to fail')
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

  query<T = Record<string, unknown>>(entity: string, options: QueryOptions): Promise<T[]> {
    return queryEntity<T>(this.sql, this.#entities, entity, options)
  }

  async tx<T>(work: (transaction: DatabaseTransaction) => T | Promise<T>): Promise<T> {
    if (this.#transaction) {
      const name = `${OWNER_SAVEPOINT_PREFIX}${this.#savepoint}`
      this.#savepoint += 1
      await this.connection.unsafe(`savepoint ${quoteIdentifier(name)}`).simple()
      try {
        const result = await work(
          transactionWithMutations(this.#entities, this.#transaction as unknown as TransactionSQL),
        )
        await this.connection.unsafe(`release savepoint ${quoteIdentifier(name)}`).simple()
        return result
      } catch (error) {
        await this.connection.unsafe(`rollback to savepoint ${quoteIdentifier(name)}`).simple()
        await this.connection.unsafe(`release savepoint ${quoteIdentifier(name)}`).simple()
        throw error
      }
    }

    await this.connection.unsafe('begin').simple()
    this.#transaction = this.connection
    try {
      await this.connection.unsafe(
        `set local search_path to ${quoteIdentifier(this.#schema)}, public, basis, pg_temp`,
      ).simple()
      return await work(transactionWithMutations(this.#entities, this.connection as unknown as TransactionSQL))
    } finally {
      this.#transaction = null
      await this.connection.unsafe('rollback').simple()
    }
  }

  upsert(entity: string, filter: MutationFilter, values: MutationValues) {
    return this.#mutations().upsert(entity, filter, values)
  }

  async use(entities: EntityDefinitions): Promise<void> {
    const schema = await this.schemaFor(entities)
    if (schema !== this.#schema) {
      await this.sql.unsafe(
        `set local search_path to ${quoteIdentifier(schema)}, public, basis, pg_temp`,
      ).simple()
      this.#schema = schema
    }
    this.#entities = entities
  }

  #mutations(): MutationDatabase {
    return mutationRunner(this.#entities, this.sql)
  }
}

/**
 * Return a reserved fixture connection to a clean session state.
 * @param connection - Reserved Bun SQL connection.
 */
async function resetConnection(connection: BunSQL): Promise<void> {
  await connection.unsafe('rollback').simple().catch(() => undefined)
  await connection.unsafe('reset all').simple().catch(() => undefined)
}

/**
 * Wrap a reserved connection so every release resets it first.
 * @param connection - Reserved Bun SQL connection.
 * @returns The wrapped connection.
 */
function guardedConnection(connection: BunSQL): BunSQL {
  return new Proxy(connection, {
    apply: (target, _thisArg, args) => Reflect.apply(target, target, args),
    get: (target, property, receiver) => {
      if (property === 'release') {
        return async () => {
          await resetConnection(target);
          (target as unknown as { release: () => void }).release()
        }
      }
      return Reflect.get(target, property, receiver)
    },
  })
}

/**
 * Wrap a fixture pool so direct reserves acquire and release clean connections.
 * @param pool - The fixture Bun SQL pool.
 * @returns The guarded pool.
 */
function guardedPool(pool: BunSQL): BunSQL {
  return new Proxy(pool, {
    apply: (target, _thisArg, args) => Reflect.apply(target, target, args),
    get: (target, property, receiver) => {
      if (property === 'reserve') {
        return async () => {
          const connection = await target.reserve()
          await resetConnection(connection as unknown as BunSQL)
          return guardedConnection(connection as unknown as BunSQL)
        }
      }
      return Reflect.get(target, property, receiver)
    },
  })
}

/** The test-owned pool connected to the one seeded database container. */
class FixtureDatabase implements Database {
  #closed = false
  #closing: Promise<void> | null = null
  #entities: EntityDefinitions
  #guarded: BunSQL | null = null
  #sql: BunSQL

  /**
   * Create the fixture pool.
   * @param url - Loopback connection URL for the seeded container.
   * @param entities - Shared entity definitions.
   */
  constructor(url: string, entities: EntityDefinitions) {
    this.#entities = entities
    this.#sql = new BunSQL({ ...POOL_DEFAULTS, url })
  }

  /**
   * Whether the pool has been closed.
   * @returns `true` once close has started.
   */
  get closed(): boolean {
    return this.#closed
  }

  /**
   * The pooled Bun SQL tagged-template API.
   * @returns The underlying SQL client.
   */
  get sql(): BunSQL {
    this.#guarded ??= guardedPool(this.#sql)
    return this.#guarded
  }

  /**
   * Establish the pool's initial connection.
   */
  async connect(): Promise<void> {
    if (this.#closed) throw new Error('Database fixture is closed')
    await this.#sql.connect()
  }

  /**
   * Close the pool exactly once.
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
    return this.tx(tx => tx.create(entity, values))
  }

  /**
   * Delete every actor-authorized match.
   * @param entity - Entity or abstract ancestor name.
   * @param filter - Existing filter form.
   * @returns The deleted count.
   */
  delete(entity: string, filter: MutationFilter): Promise<DeleteResult> {
    return this.tx(tx => tx.delete(entity, filter))
  }

  /**
   * Patch every actor-authorized match.
   * @param entity - Entity or abstract ancestor name.
   * @param filter - Existing filter form.
   * @param changes - Field values to patch.
   * @returns The edited count.
   */
  edit(entity: string, filter: MutationFilter, changes: MutationValues): Promise<EditResult> {
    return this.tx(tx => tx.edit(entity, filter, changes))
  }

  query<T = Record<string, unknown>>(entity: string, options: QueryOptions): Promise<T[]> {
    return this.tx(tx => queryEntity<T>(tx, this.#entities, entity, options))
  }

  /**
   * Run a pooled transaction with the current actor context.
   * @param callback - Transaction-scoped work.
   * @returns The callback result after commit.
   */
  tx<T>(callback: (tx: DatabaseTransaction) => T | Promise<T>): Promise<BunSQL.ContextCallbackResult<T>> {
    if (this.#closed) return Promise.reject(new Error('Database fixture is closed'))
    return this.#sql.begin(async tx => {
      const actor = currentActor()
      await tx`select set_config('actor.id', ${actor?.id ?? ''}, true)`
      const result = await callback(transactionWithMutations(this.#entities, tx))
      await validateTransactionState(this.#entities, tx)
      return result
    }).catch((error: unknown) => {
      if (error instanceof RollbackSignal) return error.value as BunSQL.ContextCallbackResult<T>
      throw error
    })
  }

  /**
   * Run work with explicit definitions and always roll back.
   * @param entities - Definitions exposed to the transaction.
   * @param work - Transaction-scoped work.
   * @returns The work result after rollback.
   */
  testWith<T>(
    entities: EntityDefinitions,
    work: (tx: DatabaseTransaction) => T | Promise<T>,
  ): Promise<T> {
    return this.#sql.begin(async tx => {
      const actor = currentActor()
      await tx`select set_config('actor.id', ${actor?.id ?? ''}, true)`
      const transaction = transactionWithMutations(entities, tx)
      return transaction.test(work)
    }).catch((error: unknown) => {
      if (error instanceof RollbackSignal) return error.value as T
      throw error
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
    return this.tx(tx => tx.upsert(entity, filter, values))
  }
}

/** A started in-process database fixture. */
export interface DatabaseFixture {
  /** The pooled test database connected to the one seeded container. */
  readonly database: Database,
  /** Entity definitions attached to the shared database. */
  readonly entities: EntityDefinitions,
  /** Fixture schema installed once by this fixture. */
  readonly fixtureSchema: string,
  /** Installation whose seeded service is shared. */
  readonly install: string,
  /** Resolve or create the schema for one exact entity definition set. */
  readonly schemaFor: (entities: EntityDefinitions, options?: FixtureSchemaOptions) => Promise<string>,
  /** Fixture service name used for cleanup and activity evidence. */
  readonly service: string,
  /** Run explicit definitions in one rolled-back transaction. */
  readonly testWith: <T>(entities: EntityDefinitions, work: (tx: DatabaseTransaction) => T | Promise<T>) => Promise<T>,
}

/** The process-wide fixture registry. */
interface DatabaseFixtureRegistry {
  /** Whether cleanup was registered with the testing lifecycle. */
  cleanupRegistered: boolean,
  /** Whether the synchronous process-exit cleanup was registered. */
  exitRegistered: boolean,
  /** The fixture being started or already running. */
  fixture: Promise<DatabaseFixture> | null,
  /** The service being started, available before startup completes. */
  pending: { readonly install: string, readonly service: string } | null,
  /** Whether the seeded container has been removed. */
  serviceRemoved: boolean,
  /** Whether run cleanup has started. */
  stopped: boolean,
  /** The resolved fixture, when startup completed. */
  value: DatabaseFixture | null,
}

/** The `globalThis` property that holds the fixture registry. */
const REGISTRY_PROPERTY = '__basisDatabaseFixture'

/**
 * The process-wide registry, created on first use.
 * @returns The shared registry.
 */
function registry(): DatabaseFixtureRegistry {
  const scope = globalThis as unknown as Record<string, unknown>
  const existing = scope[REGISTRY_PROPERTY] as DatabaseFixtureRegistry | undefined
  if (existing) return existing

  const created: DatabaseFixtureRegistry = {
    cleanupRegistered: false,
    exitRegistered: false,
    fixture: null,
    pending: null,
    serviceRemoved: false,
    stopped: false,
    value: null,
  }
  scope[REGISTRY_PROPERTY] = created
  return created
}

/**
 * Append a fixture lifecycle event when observability is enabled.
 * @param event - Event line to record.
 */
function record(event: string): void {
  const path = process.env[ACTIVITY_LOG]
  if (!path) return
  try {
    appendFileSync(path, `${event}\n`)
  } catch {
    // Observability only; a failed log must never fail the fixture.
  }
}

/**
 * Acquire the run-wide ordinary database fixture.
 *
 * The first caller starts one seeded PostgreSQL container. Later callers,
 * including callers in other test files and subprocesses, await the same
 * process-wide promise or attach to the same stable container. The pool closes
 * at run cleanup; the container never outlives the run.
 * @param label - Short caller label recorded in the optional activity log.
 * @returns The shared running fixture.
 * @throws {Error} When called after run cleanup has started.
 */
export async function useDatabaseFixture(label: string): Promise<DatabaseFixture> {
  const scope = registry()
  if (scope.stopped) throw new Error('The database fixture cannot start after run cleanup')
  record(`acquire ${label}`)

  if (!scope.fixture) {
    scope.fixture = startFixture(scope).then(fixture => {
      scope.value = fixture
      return fixture
    })
    if (!scope.cleanupRegistered) {
      scope.cleanupRegistered = true
      registerRunCleanup(() => cleanupFixture(scope))
    }
    if (!scope.exitRegistered) {
      scope.exitRegistered = true
      process.once('exit', () => cleanupOnExit(scope))
    }
  }
  return await scope.fixture
}

/**
 * Start the one seeded database container and its test pool.
 * @param scope - The process-wide fixture registry.
 * @returns The running fixture.
 */
async function startFixture(scope: DatabaseFixtureRegistry): Promise<DatabaseFixture> {
  const service = `basis-database-fixture-${randomUUID()}`
  const install = fixtureInstall()
  if (containers(install).length > 0) removeService(install)

  scope.pending = { install, service }
  let database: FixtureDatabase | null = null
  try {
    await ensureSeedImage()
    await startContainer(install)
    const [container] = containers(install)
    if (!container) throw new Error('The shared database fixture did not start a container')
    const port = await publishedPort(container)
    database = new FixtureDatabase(`postgres://basis@127.0.0.1:${port}/basis`, sharedEntities)
    await database.connect()

    const schemas = new Map<string, Promise<string>>()
    const schemaFor = (
      entities: EntityDefinitions,
      options: FixtureSchemaOptions = {},
    ): Promise<string> => {
      const schema = assertTestSchema(fixtureSchemaName(entities, options.appRole, options.graph))
      let pending = schemas.get(schema)
      if (!pending) {
        pending = ensureSchema(database as FixtureDatabase, schema, entities, options)
        schemas.set(schema, pending)
        void pending.catch(() => schemas.delete(schema))
      }
      return pending
    }

    await ensureApplicationRole(database)
    await installBasis(database.sql, FIXTURE_APP_ROLE)
    const fixture: DatabaseFixture = {
      database,
      entities: sharedEntities,
      fixtureSchema: FIXTURE_SCHEMA,
      install,
      schemaFor,
      service,
      testWith: (entities, work) => database.testWith(entities, work),
    }
    await fixture.schemaFor(sharedEntities)
    record(`start ${service} ${install} ${process.pid}`)
    return fixture
  } catch (error) {
    await database?.close()
    scope.serviceRemoved = removeService(install)
    throw error
  }
}

/**
 * Close the fixture pool; remove the seeded container for run-scoped fixtures.
 * @param scope - The process-wide fixture registry.
 */
async function cleanupFixture(scope: DatabaseFixtureRegistry): Promise<void> {
  if (scope.stopped) return
  record('cleanup')
  scope.stopped = true
  const fixture = await scope.fixture?.catch(() => undefined)
  if (fixture) await fixture.database.close()

  const service = fixture ?? scope.pending
  if (service) {
    removeManagedService(scope, service)
  }
}

/**
 * Remove the seeded container synchronously when the process exits.
 *
 * The async run cleanup covers normal completion and failures. This exit
 * handler is the signal safety net for in-process resources: it runs before the
 * process closes and performs the synchronous container removal even if an
 * interrupt prevents the async cleanup from finishing.
 * @param scope - The process-wide fixture registry.
 */
function cleanupOnExit(scope: DatabaseFixtureRegistry): void {
  const service = scope.value ?? scope.pending
  if (service) removeManagedService(scope, service)
}

/**
 * Remove a fixture's seeded container exactly once.
 * @param scope - The process-wide fixture registry.
 * @param service - Service identity to remove.
 * @param service.install - Installation root used for container ownership.
 * @param service.service - Service name recorded in the activity log.
 */
function removeManagedService(
  scope: DatabaseFixtureRegistry,
  service: { readonly install: string, readonly service: string },
): void {
  if (scope.serviceRemoved) return
  if (!removeService(service.install)) {
    record(`remove-failed ${service.service} ${service.install} ${process.pid}`)
    return
  }
  scope.serviceRemoved = true
  record(`stop ${service.service} ${service.install} ${process.pid}`)
}

/**
 * Start the one seeded container for an installation.
 * @param install - Fixture installation root.
 */
async function startContainer(install: string): Promise<void> {
  reapDeadTestContainers()
  const identity = managedDatabaseIdentity(install)
  const name = `basis-database-fixture-${identity}`
  const started = await runAsync('docker', [
    'run',
    '-d',
    '--pull', 'missing',
    '--name', name,
    '--label', `basis.database=${identity}`,
    '--label', `basis.install=${install}`,
    ...testContainerLabels(),
    '-p', `127.0.0.1::${DATABASE_PORT}`,
    seedImage(),
  ])
  if (started.exitCode !== 0 && containers(install).length === 0) {
    throw new Error(`Seeded PostgreSQL fixture failed to start: ${started.stderr.trim()}`)
  }
  await waitForReady(name)
}

/**
 * Wait for the seeded container to accept connections.
 * @param name - Container name.
 */
async function waitForReady(name: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const ready = await runAsync('docker', [
      'exec', name, 'pg_isready', '-U', 'basis', '-d', 'basis',
    ])
    if (ready.exitCode === 0) return
    await Bun.sleep(READY_POLL_MS)
  }
  throw new Error('Seeded PostgreSQL fixture did not become ready')
}

/**
 * Read the published loopback port for a container.
 * @param id - Container id.
 * @returns The published PostgreSQL port.
 */
async function publishedPort(id: string): Promise<number> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await runAsync`docker port ${id} ${`${DATABASE_PORT}/tcp`}`
    const match = /:(\d+)\s*$/m.exec(result.stdout.trim())
    if (match?.[1]) return Number(match[1])
    await Bun.sleep(READY_POLL_MS)
  }
  throw new Error('Seeded PostgreSQL fixture did not publish a loopback port')
}

/**
 * Resolve the fixture installation for this checkout.
 * @returns The stable installation directory.
 */
function fixtureInstall(): string {
  const configured = Bun.env.BASIS_TEST_FIXTURE_ROOT
  if (configured) {
    const install = resolve(configured)
    mkdirSync(install, { mode: 0o700, recursive: true })
    return install
  }

  const cache = Bun.env.XDG_CACHE_HOME ?? join(homedir(), '.cache')
  const checkout = createHash('sha1').update(resolve(process.cwd())).digest('hex').slice(0, 16)
  const install = join(cache, 'basis', 'test-fixture', checkout)
  mkdirSync(install, { mode: 0o700, recursive: true })
  return install
}

/**
 * Derive the schema name for one exact entity definition set.
 * @param entities - Canonical definitions.
 * @param appRole - Restricted application role, when policies are installed.
 * @param graph - Canonical Graph whose security should be installed.
 * @returns A stable schema identifier.
 */
function fixtureSchemaName(entities: EntityDefinitions, appRole?: string, graph?: Graph): string {
  const hash = createHash('sha256')
    .update(
      `${entities.ddl.join('\n')}\nreviewed-install-v1\n${appRole ?? ''}\n` +
      `${graph ? JSON.stringify(graph.toJSON()) : ''}`,
    )
    .digest('hex')
    .slice(0, 16)
  return `basis_fixture_${hash}`
}

/** Roles already created or normalized by this fixture process. */
const ensuredApplicationRoles = new Map<string, Promise<void>>()

/**
 * Ensure the restricted role used by the fixture graph exists once.
 * @param database - Connected fixture pool.
 * @param roleName - Application role to create or normalize.
 * @returns A promise that settles once the role is ready.
 */
function ensureApplicationRole(
  database: Database,
  roleName = FIXTURE_APP_ROLE,
): Promise<void> {
  let pending = ensuredApplicationRoles.get(roleName)
  if (!pending) {
    pending = createApplicationRole(database, roleName)
    ensuredApplicationRoles.set(roleName, pending)
    void pending.catch(() => ensuredApplicationRoles.delete(roleName))
  }
  return pending
}

/**
 * Create or normalize one application role.
 * @param database - Connected fixture pool.
 * @param roleName - Application role to create or normalize.
 */
async function createApplicationRole(database: Database, roleName: string): Promise<void> {
  const role = quoteIdentifier(roleName)
  await database.sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
        CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOINHERIT NOBYPASSRLS;
      ELSE
        ALTER ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOINHERIT NOBYPASSRLS;
      END IF;
    END $$;
  `).simple()
}

/**
 * Seed the deterministic fixture rows once.
 * @param sql - Fixture owner transaction scoped to the fixture schema.
 */
async function seedFixtureRows(sql: BunSQL): Promise<void> {
  const row = fixtureRows
  await sql`
    INSERT INTO "Entity" ("id", "name", "entity")
    VALUES
      (${row.alice}, 'Alice', 'User'),
      (${row.bob}, 'Bob', 'User'),
      (${row.memberNote}, 'Member note', 'MemberNote'),
      (${row.linkedNote}, 'Linked note', 'MemberNote'),
      (${row.anonymousNote}, 'Anonymous note', 'AnonymousNote'),
      (${row.visibleWorkspace}, 'Visible workspace', 'Workspace'),
      (${row.editorWorkspace}, 'Editor workspace', 'Workspace'),
      (${row.viewerWorkspace}, 'Viewer workspace', 'Workspace'),
      (${row.hiddenWorkspace}, 'Hidden workspace', 'Workspace'),
      (${row.project}, 'Project', 'Project'),
      (${row.secondProject}, 'Second project', 'Project'),
      (${row.thirdProject}, 'Third project', 'Project'),
      (${row.openTask}, 'Open task', 'Task'),
      (${row.otherTask}, 'Other task', 'Task'),
      (${row.note}, 'Fixture note', 'Note'),
      (${row.account}, 'Fixture account', 'Account'),
      (${row.numberRow}, 'Fixture number row', 'NumberRow'),
      (${row.queryRow}, 'Fixture query row', 'QueryRow'),
      (${row.article}, 'Fixture article', 'Article')
  `
  await sql`
    INSERT INTO "User" ("id", "label", "email")
    VALUES
      (${row.alice}, 'Alice', 'alice@example.com'),
      (${row.bob}, 'Bob', 'bob@example.com')
  `
  await sql`
    INSERT INTO "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
    VALUES (${row.note}, 'Fixture note', TRUE, 3, '2030-01-01', '2020-01-01T00:00:00Z')
  `
  await sql`
    INSERT INTO "Account" ("id", "label")
    VALUES (${row.account}, 'Fixture account')
  `
  await sql`
    INSERT INTO "NumberRow" ("id", "value")
    VALUES (${row.numberRow}, 7)
  `
  await sql`
    INSERT INTO "QueryRow" ("id", "active", "externalId", "rank", "score", "title")
    VALUES (${row.queryRow}, TRUE, 1, 2, 3, 'Fixture query row')
  `
  await sql`
    INSERT INTO "Article" ("id", "title", "owner.id")
    VALUES (${row.article}, 'Fixture article', ${row.alice})
  `
  await sql`
    INSERT INTO "MemberNote" ("id", "title")
    VALUES (${row.memberNote}, 'Member note'), (${row.linkedNote}, 'Linked note')
  `
  await sql`
    INSERT INTO "AnonymousNote" ("id", "title")
    VALUES (${row.anonymousNote}, 'Anonymous note')
  `
  await sql`
    INSERT INTO "ActorLink" ("note.id", "related.id")
    VALUES (${row.memberNote}, ${row.linkedNote})
  `
  await sql`
    INSERT INTO "Workspace" ("id", "title")
    VALUES
      (${row.visibleWorkspace}, 'Visible workspace'),
      (${row.hiddenWorkspace}, 'Hidden workspace'),
      (${row.editorWorkspace}, 'Editor workspace'),
      (${row.viewerWorkspace}, 'Viewer workspace')
  `
  await sql`
    INSERT INTO "Project" ("id", "title", "workspace.id")
    VALUES
      (${row.project}, 'visible', ${row.visibleWorkspace}),
      (${row.secondProject}, 'visible', ${row.hiddenWorkspace}),
      (${row.thirdProject}, 'other', ${row.hiddenWorkspace})
  `
  await sql`
    INSERT INTO "Task" ("id", "title", "project.id")
    VALUES
      (${row.openTask}, 'open', ${row.project}),
      (${row.otherTask}, 'open', ${row.thirdProject})
  `
  await sql`
    INSERT INTO "WorkspaceMembership" ("workspace.id", "user.id", "role")
    VALUES
      (${row.visibleWorkspace}, ${row.alice}, 'Owner'),
      (${row.editorWorkspace}, ${row.alice}, 'Editor'),
      (${row.viewerWorkspace}, ${row.alice}, 'Viewer')
  `
  await sql`
    INSERT INTO "Entity" ("id", "name", "entity")
    VALUES
      (${row.ownerA}, 'Owner A', 'Owner'),
      (${row.ownerB}, 'Owner B', 'Owner'),
      (${row.revisionA}, 'Revision A', 'Revision'),
      (${row.orphanRevision}, 'Orphan revision', 'Revision'),
      (${row.validDocument}, 'Valid document', 'Document'),
      (${row.invalidChildDocument}, 'Invalid child document', 'Document'),
      (${row.invalidParentDocument}, 'Invalid parent document', 'Document'),
      (${row.orphanDocument}, 'Orphan document', 'Document'),
      (${row.guardedWorkspace}, 'Guarded workspace', 'GuardedWorkspace')
  `
  await sql`
    INSERT INTO "Owner" ("id", "label")
    VALUES (${row.ownerA}, 'A'), (${row.ownerB}, 'B')
  `
  await sql`
    INSERT INTO "Revision" ("id", "owner.id")
    VALUES (${row.revisionA}, ${row.ownerA}), (${row.orphanRevision}, ${null})
  `
  await sql`
    INSERT INTO "Record" ("id", "title", "status")
    VALUES
      (${row.validDocument}, 'Valid', 'ok'),
      (${row.invalidChildDocument}, 'Invalid child', 'ok'),
      (${row.invalidParentDocument}, 'Invalid parent', 'bad'),
      (${row.orphanDocument}, 'Orphan', 'ok')
  `
  await sql`
    INSERT INTO "Document" ("id", "flag", "note", "owner.id", "revision.id")
    VALUES
      (${row.validDocument}, TRUE, 'note', ${row.ownerA}, ${row.revisionA}),
      (${row.invalidChildDocument}, FALSE, 'note', ${row.ownerA}, ${row.revisionA}),
      (${row.invalidParentDocument}, TRUE, 'note', ${row.ownerA}, ${row.revisionA}),
      (${row.orphanDocument}, TRUE, 'note', ${row.ownerA}, ${row.orphanRevision})
  `
  await sql`
    INSERT INTO "GuardedWorkspace" ("id", "flag", "title")
    VALUES (${row.guardedWorkspace}, TRUE, 'Guarded workspace')
  `
  await sql`
    INSERT INTO "GuardedMembership" ("workspace.id", "user.id")
    VALUES (${row.guardedWorkspace}, ${row.alice})
  `
}

/**
 * Run one test on the shared fixture with an optional custom Graph and actor.
 * @param label - Fixture acquisition label.
 * @param callback - Work using the app-role transaction.
 * @param options - Custom Graph and owner-run setup.
 * @returns The callback result after rollback.
 */
export function withDatabase<T>(
  label: string,
  callback: (database: DatabaseContext) => Promise<T>,
  options?: DatabaseTestOptions,
): Promise<T>
export function withDatabase<T>(
  label: string,
  actor: string | null,
  callback: (database: DatabaseContext) => Promise<T>,
  options?: DatabaseTestOptions,
): Promise<T>
export async function withDatabase<T>(
  label: string,
  actorOrCallback: string | null | ((database: DatabaseContext) => Promise<T>),
  callbackOrOptions?: ((database: DatabaseContext) => Promise<T>) | DatabaseTestOptions,
  maybeOptions: DatabaseTestOptions = {},
): Promise<T> {
  const inline = typeof actorOrCallback === 'function'
  const actor = inline ? null : actorOrCallback
  const callback = inline
    ? actorOrCallback
    : callbackOrOptions as (database: DatabaseContext) => Promise<T>
  const options = inline
    ? (callbackOrOptions as DatabaseTestOptions | undefined) ?? {}
    : maybeOptions
  if (inline || options.owner || options.commit) {
    return withOwnerDatabase(label, callback, {
      commit: options.commit,
      entities: options.entities,
      fresh: options.fresh,
    })
  }
  const fixture = await useDatabaseFixture(label)
  const custom = options.graph !== undefined
  const entities = options.graph?.definitions ?? fixtureGraph.definitions
  const appRole = FIXTURE_APP_ROLE
  if (!custom) await ensureGraphSchema(fixture.database)
  const schema = custom
    ? await fixture.schemaFor(entities, { appRole, graph: options.graph })
    : fixture.fixtureSchema
  return runAsActor({ id: actor }, () => fixture.testWith(
    entities,
    async sql => {
      await sql.unsafe(
        `set local search_path to ${quoteIdentifier(schema)}, public, basis, pg_temp`,
      ).simple()
      let currentEntities = entities
      let currentSchema = schema
      let active = sql as DatabaseTransaction
      const context = (): DatabaseContext => {
        const tx = async <Result>(work: (sql: DatabaseTransaction) => Result | Promise<Result>) => {
          const savepoint = active.savepoint as unknown as <Value>(
            callback: (sql: DatabaseTransaction) => Value | Promise<Value>,
          ) => Promise<Value>
          return savepoint(async savepointSql => {
            const result = await work(savepointSql)
            await validateTransactionState(currentEntities, transactionClient(savepointSql))
            return result
          })
        }
        const captureError = async (work: (database: DatabaseContext) => Promise<unknown>) => {
          let failure: unknown
          try {
            await tx(async () => {
              failure = await work(context())
              throw failure
            })
          } catch (error) {
            if (error !== failure) throw error
          }
          return failure
        }
        const asOwner = async <Result>(
          work: (database: DatabaseContext) => Promise<Result>,
        ): Promise<Result> => {
          const connection = await fixture.database.sql.reserve()
          try {
            await connection.unsafe('reset role').simple()
            await connection.unsafe(
              `set search_path to ${quoteIdentifier(currentSchema)}, public, basis, pg_temp`,
            ).simple()
            return await work(new OwnerDatabaseContext(
              connection,
              currentSchema,
              currentEntities,
              nextEntities => fixture.schemaFor(nextEntities),
            ))
          } finally {
            await connection.unsafe('rollback').simple().catch(() => undefined)
            await connection.unsafe('reset all').simple().catch(() => undefined)
            connection.release()
          }
        }
        const use = async (nextEntities: EntityDefinitions): Promise<void> => {
          const nextSchema = await fixture.schemaFor(nextEntities)
          if (nextSchema !== currentSchema) {
            await sql.unsafe(
              `set local search_path to ${quoteIdentifier(nextSchema)}, public, basis, pg_temp`,
            ).simple()
            currentSchema = nextSchema
          }
          currentEntities = nextEntities
          active = transactionWithMutations(
            currentEntities,
            transactionClient(active) as unknown as TransactionSQL,
          )
        }
        return {
          asOwner,
          captureError,
          create: (entity, values) => tx(savepoint => savepoint.create(entity, values)),
          delete: (entity, filter) => tx(savepoint => savepoint.delete(entity, filter)),
          edit: (entity, filter, changes) => tx(savepoint => savepoint.edit(entity, filter, changes)),
          entities: currentEntities,
          query: <Result = Record<string, unknown>>(entity: string, queryOptions: QueryOptions) => (
            queryEntity<Result>(sql, currentEntities, entity, queryOptions)
          ),
          schema: currentSchema,
          sql,
          tx,
          upsert: (entity, filter, values) => tx(savepoint => savepoint.upsert(entity, filter, values)),
          use,
        }
      }
      await options.setup?.(context())
      await sql.unsafe(`set local role ${quoteIdentifier(appRole)}`).simple()
      await sql`
        SELECT SET_CONFIG('actor.id', ${actor ?? ''}, TRUE)
      `
      return callback(context())
    },
  ))
}

/** Entity and schema options for one internal owner proof. */
export interface OwnerDatabaseOptions {
  /** Commit instead of rolling back for an explicit commit proof. */
  readonly commit?: boolean,
  /** Entity definitions to prepare and query; defaults to the fixture model. */
  readonly entities?: EntityDefinitions,
  /** Allocate a disposable unique schema for the proof. */
  readonly fresh?: boolean,
}

/**
 * Run one internal owner-role proof inside the fixture transaction.
 *
 * This is the fixture/engine proof path. It does not select the app role and it
 * does not publish a second consumer testing API.
 * @param label - Fixture acquisition label.
 * @param callback - Work using the owner transaction context.
 * @param options - Entity definitions and disposable-schema selection.
 * @returns The callback result after rollback.
 */
export async function withOwnerDatabase<T>(
  label: string,
  callback: (database: DatabaseContext) => Promise<T>,
  options: OwnerDatabaseOptions = {},
): Promise<T> {
  const fixture = await useDatabaseFixture(label)
  const entities = options.entities ?? fixture.entities
  const schema = options.fresh ? committedSchemaName() : await fixture.schemaFor(entities)
  const connection = await fixture.database.sql.reserve()
  const context = new OwnerDatabaseContext(
    connection,
    schema,
    entities,
    nextEntities => fixture.schemaFor(nextEntities),
  )
  let completed = false
  try {
    await connection.unsafe('reset role').simple()
    if (options.fresh) {
      await connection.unsafe(`create schema ${quoteIdentifier(schema)}`).simple()
    }
    await context.begin()
    const result = await callback(context)
    if (options.commit) {
      await context.commit()
      completed = true
    }
    return result
  } finally {
    if (!completed) await context.rollback().catch(() => undefined)
    await connection.unsafe('rollback').simple().catch(() => undefined)
    await connection.unsafe('reset all').simple().catch(() => undefined)
    if (options.fresh) {
      await connection.unsafe(`drop schema if exists ${quoteIdentifier(schema)} cascade`)
        .simple().catch(() => undefined)
    }
    connection.release()
  }
}

/**
 * Ensure the cached schema exists and contains the requested definitions.
 * @param database - Connected fixture pool.
 * @param schema - Stable schema name.
 * @param entities - Canonical definitions.
 * @param options - Schema installation options.
 * @returns The schema identifier once initialization is complete.
 */
async function ensureSchema(
  database: FixtureDatabase,
  schema: string,
  entities: EntityDefinitions,
  options: FixtureSchemaOptions = {},
): Promise<string> {
  assertTestSchema(schema)
  const appRole = options.appRole
  if (appRole !== undefined) await ensureApplicationRole(database, appRole)
  await database.tx(async sql => {
    await sql`
      SELECT PG_ADVISORY_XACT_LOCK(HASHTEXT(${schema}))
    `
    const present = await sql<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schema}) AS present
    `
    if (present[0]?.present) return

    await sql.unsafe(`create schema ${quoteIdentifier(schema)}`).simple()
    await sql.unsafe(`set local search_path to ${quoteIdentifier(schema)}, public, basis, pg_temp`).simple()
    const desired = options.graph === undefined
      ? entities
      : new Graph({ ...options.graph.toJSON(), schema })
    await installSchema(sql, desired, {
      appRole,
      schema,
      superuser: appRole === undefined ? undefined : true,
      version: `fixture:${schema}`,
    })
    if (appRole !== undefined) {
      await sql.unsafe(
        `grant usage on schema ${quoteIdentifier(schema)} to ${quoteIdentifier(appRole)}`,
      ).simple()
      await sql.unsafe(
        `grant select, insert, update, delete on all tables in schema ${quoteIdentifier(schema)} ` +
        `to ${quoteIdentifier(appRole)}`,
      ).simple()
    }
    record(`schema ${schema}`)
  })
  return schema
}

/**
 * Install and seed the one fixture graph in its dedicated schema.
 * @param database - Connected fixture pool.
 * @returns The fixture graph schema name.
 */
async function ensureGraphSchema(database: Database): Promise<string> {
  const schema = FIXTURE_SCHEMA
  await database.tx(async sql => {
    await sql`
      SELECT PG_ADVISORY_XACT_LOCK(HASHTEXT(${schema}))
    `
    const present = await sql<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schema}) AS present
    `
    let complete = Boolean(present[0]?.present)
    if (complete) {
      for (const entity of fixtureGraph.definitions.entities) {
        const [table] = await sql<{ table_name: string }[]>`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = ${schema} AND table_name = ${entity.name}
        `
        if (!table?.table_name) {
          complete = false
          break
        }
      }
    }
    if (complete) {
      for (const trigger of fixtureGraph.physicalSchema(FIXTURE_APP_ROLE, true).triggers) {
        const [found] = await sql<{ present: boolean }[]>`
          SELECT EXISTS (
            SELECT 1
            FROM pg_trigger "trigger"
            JOIN pg_class relation ON relation.oid = trigger.tgrelid
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = ${schema} AND trigger.tgname = ${trigger.name}
          ) AS present
        `
        if (!found?.present) {
          complete = false
          break
        }
      }
    }
    if (complete) {
      const [legacy] = await sql<{ present: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_trigger "trigger"
          JOIN pg_class relation ON relation.oid = trigger.tgrelid
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = ${schema}
            AND (
              trigger.tgname ILIKE '%enroll%'
              OR pg_get_triggerdef(trigger.oid) ILIKE '%enroll_identity%'
            )
        ) AS present
      `
      if (legacy?.present) complete = false
    }
    if (complete) {
      const [seeded] = await sql<{ seeded: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM ${sql(schema)}.${sql('Entity')}
          WHERE "id" = ${fixtureRows.alice}
        ) AS seeded
      `
      complete = Boolean(seeded?.seeded)
    }
    if (complete) return

    await sql.unsafe(`drop schema if exists ${quoteIdentifier(schema)} cascade`).simple()
    await sql.unsafe(`create schema ${quoteIdentifier(schema)}`).simple()
    await sql.unsafe(
      `set local search_path to ${quoteIdentifier(schema)}, public, basis, pg_temp`,
    ).simple()
    await installSchema(sql, fixtureGraph, {
      appRole: FIXTURE_APP_ROLE,
      schema,
      superuser: true,
      version: `fixture-graph:${schema}:${randomUUID()}`,
    })
    await sql.unsafe(
      `grant usage on schema ${quoteIdentifier(schema)} to ${quoteIdentifier(FIXTURE_APP_ROLE)}`,
    ).simple()
    await sql.unsafe(
      `grant select, insert, update, delete on all tables in schema ${quoteIdentifier(schema)} ` +
      `to ${quoteIdentifier(FIXTURE_APP_ROLE)}`,
    ).simple()
    await seedFixtureRows(sql)
    record(`fixture graph schema ${schema}`)
  })
  return schema
}

/**
 * Quote a generated PostgreSQL identifier.
 * @param identifier - Safe generated identifier.
 * @returns The quoted identifier.
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

/** Schemas Basis never creates through test schema registration. */
const RESERVED_SCHEMAS = new Set([
  'basis',
  'public',
  'pg_catalog',
  'information_schema',
  'pg_temp',
  'pg_toast',
])

/**
 * Fail closed before any test schema registration can claim a reserved schema.
 * @param schema - Proposed test schema.
 * @returns The same schema when it is safe to create.
 * @throws {Error} When the schema is reserved or PostgreSQL-owned.
 */
function assertTestSchema(schema: string): string {
  const normalized = schema.toLowerCase()
  if (RESERVED_SCHEMAS.has(normalized) || normalized.startsWith('pg_')) {
    throw new Error(`Test schema registration refuses reserved schema "${schema}"`)
  }
  return schema
}

/**
 * Create a unique per-proof schema name.
 * @returns A safe schema identifier.
 */
function committedSchemaName(): string {
  return assertTestSchema(`basis_test_${randomUUID().replaceAll('-', '')}`)
}

/**
 * Find containers owned by a fixture installation.
 * @param install - The installation root used in the ownership label.
 * @returns The container ids.
 */
export function containers(install: string): readonly string[] {
  return run`docker ps -aq --filter ${`label=basis.install=${install}`}`.lines
}

/**
 * Remove the containers and durable volume for a fixture installation and
 * verify that the ownership labels no longer resolve to resources.
 * @param install - The installation root used in the ownership label.
 * @returns `true` only after both Docker removals succeed and absence is verified.
 */
export function removeService(install: string): boolean {
  let succeeded = true

  const containerList = run`docker ps -aq --filter ${`label=basis.install=${install}`}`
  if (containerList.exitCode !== 0) succeeded = false
  for (const id of containerList.lines) {
    if (run`docker rm -f -v ${id}`.exitCode !== 0) succeeded = false
  }

  const volumeList = run`docker volume ls -q --filter ${`label=basis.install=${install}`}`
  if (volumeList.exitCode !== 0) succeeded = false
  for (const volume of volumeList.lines) {
    if (run`docker volume rm -f ${volume}`.exitCode !== 0) succeeded = false
  }

  const remainingContainers = run`docker ps -aq --filter ${`label=basis.install=${install}`}`
  const remainingVolumes = run`docker volume ls -q --filter ${`label=basis.install=${install}`}`
  return succeeded
    && remainingContainers.exitCode === 0
    && remainingContainers.lines.length === 0
    && remainingVolumes.exitCode === 0
    && remainingVolumes.lines.length === 0
}
