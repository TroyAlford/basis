import { run, runAsync } from 'basis/utilities'
import { SQL as BunSQL } from 'bun'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { seedImage } from '../../../testing/database/seed/image'
import { registerRunCleanup } from '../../testing/lifecycle'
import { currentActor, runAsActor } from '../source/ActorContext'
import type { Database, DatabaseTransaction, QueryOptions } from '../source/Database'
import { queryEntity, RollbackSignal, transactionClient, transactionWithMutations } from '../source/Database'
import { Constraint, EntityDefinitions } from '../source/EntityDefinitions'
import { Action, Graph, Security } from '../source/Graph'
import { managedDatabaseIdentity } from '../source/ManagedPostgresService'
import type { CreateResult, DeleteResult, EditResult, MutationDatabase, MutationFilter, MutationValues, UpsertResult } from '../source/Mutation'
import { clearWrittenSubjects, validateTransactionState } from '../source/Mutation'
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

/** Entities available from the shared ordinary database fixture. */
export const sharedEntities = EntityDefinitions.load(JSON.stringify({
  entities: [
    noteDefinition,
    accountDefinition,
    numberRowDefinition,
    queryRowDefinition,
    userDefinition,
    articleDefinition,
  ],
}))

/** Restricted role used by authorization fixture policies. */
const AUTHORIZATION_APP_ROLE = 'basis_app'
/** Single schema owned by the authorization fixture. */
const AUTHORIZATION_SCHEMA = 'basis_fixture_auth'

/** Deterministic identities and rows seeded into the authorization fixture. */
export const authorizationRows = {
  alice: '00000000-0000-4000-8000-000000000101',
  anonymousNote: '00000000-0000-4000-8000-000000000102',
  bob: '00000000-0000-4000-8000-000000000103',
  guardedWorkspace: '00000000-0000-4000-8000-000000000113',
  hiddenWorkspace: '00000000-0000-4000-8000-000000000112',
  invalidChildDocument: '00000000-0000-4000-8000-000000000114',
  invalidParentDocument: '00000000-0000-4000-8000-000000000115',
  linkedNote: '00000000-0000-4000-8000-000000000104',
  memberNote: '00000000-0000-4000-8000-000000000105',
  openTask: '00000000-0000-4000-8000-000000000106',
  orphanDocument: '00000000-0000-4000-8000-000000000116',
  orphanRevision: '00000000-0000-4000-8000-000000000117',
  otherTask: '00000000-0000-4000-8000-000000000107',
  ownerA: '00000000-0000-4000-8000-000000000118',
  ownerB: '00000000-0000-4000-8000-000000000119',
  project: '00000000-0000-4000-8000-000000000108',
  revisionA: '00000000-0000-4000-8000-000000000120',
  secondProject: '00000000-0000-4000-8000-000000000109',
  thirdProject: '00000000-0000-4000-8000-000000000110',
  validDocument: '00000000-0000-4000-8000-000000000121',
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
 * Canonical authorization fixture graph.
 *
 * The one ordinary database fixture installs this model and its seed rows once;
 * authorization tests reserve a transaction and run as the restricted app role.
 */
const authorizationGraph = new Graph({
  entities: [{
    fields: [{ field: 'email', type: 'String' }],
    name: 'User',
    security: { [Action.Read]: Security.Public },
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
  }],
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
      security: { [Action.Read]: Security.Public },
    },
  ],
  schema: AUTHORIZATION_SCHEMA,
})

/** Run one authorization test as the restricted app role. */
export interface AuthorizationDatabase {
  /** Query through the canonical entity compiler under RLS. */
  query: <T = Record<string, unknown>>(entity: string, options: QueryOptions) => Promise<T[]>,
  /** Reserved transaction connection already scoped to the app role. */
  readonly sql: DatabaseTransaction,
}

/** Run one validation test through the shared app-role transaction. */
export interface ValidationDatabase extends AuthorizationDatabase {
  create: Database['create'],
  delete: Database['delete'],
  edit: Database['edit'],
  tx: <T>(work: (transaction: MutationDatabase) => T | Promise<T>) => Promise<T>,
  upsert: Database['upsert'],
}

/** The test-owned pool connected to the one seeded database container. */
class FixtureDatabase implements Database {
  #closed = false
  #closing: Promise<void> | null = null
  #entities: EntityDefinitions
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
    return this.#sql
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
  /** Authorization schema installed once by this fixture. */
  readonly authorizationSchema: string,
  /** The pooled test database connected to the one seeded container. */
  readonly database: Database,
  /** Entity definitions attached to the shared database. */
  readonly entities: EntityDefinitions,
  /** Installation whose seeded service is shared. */
  readonly install: string,
  /** Resolve or create the schema for one exact entity definition set. */
  readonly schemaFor: (entities: EntityDefinitions) => Promise<string>,
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
 * at run cleanup; the container stays available for the next run unless the
 * fixture is explicitly configured as ephemeral.
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
  let existing = containers(install).length > 0
  if (existing && Bun.env.BASIS_DATABASE_FIXTURE_EPHEMERAL === '1') {
    removeService(install)
    existing = false
  }
  if (existing) {
    const [container] = containers(install)
    const image = container
      ? run`docker inspect --format {{.Config.Image}} ${container}`.stdout.trim()
      : ''
    if (image !== seedImage()) {
      removeService(install)
      existing = false
    }
  }

  scope.pending = { install, service }
  let database: FixtureDatabase | null = null
  try {
    if (!existing) {
      await ensureSeedImage()
      await startContainer(install)
    }
    const [container] = containers(install)
    if (!container) throw new Error('The shared database fixture did not start a container')
    const port = await publishedPort(container)
    database = new FixtureDatabase(`postgres://basis@127.0.0.1:${port}/basis`, sharedEntities)
    await database.connect()

    const schemas = new Map<string, Promise<string>>()
    const schemaFor = (entities: EntityDefinitions): Promise<string> => {
      const schema = fixtureSchemaName(entities)
      let pending = schemas.get(schema)
      if (!pending) {
        pending = ensureSchema(database as FixtureDatabase, schema, entities)
        schemas.set(schema, pending)
        void pending.catch(() => schemas.delete(schema))
      }
      return pending
    }

    const fixture: DatabaseFixture = {
      authorizationSchema: '',
      database,
      entities: sharedEntities,
      install,
      schemaFor,
      service,
      testWith: (entities, work) => database.testWith(entities, work),
    }
    await fixture.schemaFor(sharedEntities)
    const authorizationSchema = await ensureAuthorizationSchema(database)
    const resolved: DatabaseFixture = { ...fixture, authorizationSchema }
    record(`${existing ? 'attach' : 'start'} ${service} ${install} ${process.pid}`)
    if (!existing) record(`canonical ${service} ${install} ${process.pid}`)
    return resolved
  } catch (error) {
    await database?.close()
    if (Bun.env.BASIS_DATABASE_FIXTURE_EPHEMERAL === '1') {
      scope.serviceRemoved = removeService(install)
    }
    throw error
  }
}

/**
 * Close the fixture pool; remove the seeded container only for ephemeral runs.
 * @param scope - The process-wide fixture registry.
 */
async function cleanupFixture(scope: DatabaseFixtureRegistry): Promise<void> {
  if (scope.stopped) return
  record('cleanup')
  scope.stopped = true
  const fixture = await scope.fixture?.catch(() => undefined)
  if (fixture) await fixture.database.close()

  const service = fixture ?? scope.pending
  if (service && Bun.env.BASIS_DATABASE_FIXTURE_EPHEMERAL === '1') {
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
  if (Bun.env.BASIS_DATABASE_FIXTURE_EPHEMERAL !== '1') return
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
  const identity = managedDatabaseIdentity(install)
  const name = `basis-database-fixture-${identity}`
  const started = await runAsync('docker', [
    'run',
    '-d',
    '--pull', 'missing',
    '--name', name,
    '--label', `basis.database=${identity}`,
    '--label', `basis.install=${install}`,
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
 * Resolve the persistent fixture installation for this checkout.
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
 * @returns A stable schema identifier.
 */
function fixtureSchemaName(entities: EntityDefinitions): string {
  const hash = createHash('sha256')
    .update(`${entities.ddl.join('\n')}\nreviewed-install-v1`)
    .digest('hex')
    .slice(0, 16)
  return `basis_fixture_${hash}`
}

/**
 * Install and seed the single authorization schema for this fixture.
 * @param database - Connected fixture pool.
 * @returns The authorization schema name.
 */
async function ensureAuthorizationSchema(database: FixtureDatabase): Promise<string> {
  const schema = AUTHORIZATION_SCHEMA
  const version = `fixture-auth:${createHash('sha256')
    .update(authorizationGraph.definitions.ddl.join('\n'))
    .digest('hex')
    .slice(0, 16)}:${randomUUID()}`
  await database.sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${AUTHORIZATION_APP_ROLE}') THEN
        CREATE ROLE "${AUTHORIZATION_APP_ROLE}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOINHERIT NOBYPASSRLS;
      ELSE
        ALTER ROLE "${AUTHORIZATION_APP_ROLE}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOINHERIT NOBYPASSRLS;
      END IF;
    END $$;
  `).simple()
  await database.tx(async sql => {
    await sql`
      SELECT pg_advisory_xact_lock(hashtext(${schema}))
    `
    const present = await sql<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schema}) AS present
    `
    if (present[0]?.present) {
      await sql.unsafe(`drop schema ${quoteIdentifier(schema)} cascade`).simple()
    }
    await sql.unsafe(`create schema ${quoteIdentifier(schema)}`).simple()
    await sql.unsafe(
      `set local search_path to ${quoteIdentifier(schema)}, public, basis, pg_temp`,
    ).simple()
    await installSchema(sql, authorizationGraph, {
      appRole: AUTHORIZATION_APP_ROLE,
      schema,
      superuser: true,
      version,
    })
    await sql.unsafe(
      `grant usage on schema ${quoteIdentifier(schema)} to ${quoteIdentifier(AUTHORIZATION_APP_ROLE)}`,
    ).simple()
    await sql.unsafe(
      `grant select, insert, update, delete on all tables in schema ${quoteIdentifier(schema)} ` +
      `to ${quoteIdentifier(AUTHORIZATION_APP_ROLE)}`,
    ).simple()
    await seedAuthorization(sql)
    record(`authorization schema ${schema}`)
  })
  return schema
}

/**
 * Seed the deterministic authorization rows once.
 * @param sql - Fixture owner transaction scoped to the authorization schema.
 */
async function seedAuthorization(sql: BunSQL): Promise<void> {
  const row = authorizationRows
  await sql`
    INSERT INTO "Entity" ("id", "name", "entity")
    VALUES (${row.alice},
      'Alice',
      'User'),
      (${row.bob},
      'Bob',
      'User'),
      (${row.memberNote},
      'Member note',
      'MemberNote'),
      (${row.linkedNote},
      'Linked note',
      'MemberNote'),
      (${row.anonymousNote},
      'Anonymous note',
      'AnonymousNote'),
      (${row.visibleWorkspace},
      'Visible workspace',
      'Workspace'),
      (${row.hiddenWorkspace},
      'Hidden workspace',
      'Workspace'),
      (${row.project},
      'Project',
      'Project'),
      (${row.secondProject},
      'Second project',
      'Project'),
      (${row.thirdProject},
      'Third project',
      'Project'),
      (${row.openTask},
      'Open task',
      'Task'),
      (${row.otherTask},
      'Other task',
      'Task')
  `
  await sql`
    INSERT INTO "User" ("id", "email")
    VALUES (${row.alice}, 'alice@example.com'), (${row.bob}, 'bob@example.com')
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
    VALUES (${row.visibleWorkspace}, 'Visible workspace'), (${row.hiddenWorkspace}, 'Hidden workspace')
  `
  await sql`
    INSERT INTO "Project" ("id", "title", "workspace.id")
    VALUES (${row.project},
      'visible',
      ${row.visibleWorkspace}),
      (${row.secondProject},
      'visible',
      ${row.hiddenWorkspace}),
      (${row.thirdProject},
      'other',
      ${row.hiddenWorkspace})
  `
  await sql`
    INSERT INTO "Task" ("id", "title", "project.id")
    VALUES (${row.openTask}, 'open', ${row.project}), (${row.otherTask}, 'open', ${row.thirdProject})
  `
  await sql`
    INSERT INTO "WorkspaceMembership" ("workspace.id", "user.id", "role")
    VALUES (${row.visibleWorkspace}, ${row.alice}, 'Owner')
  `
  await sql`
    INSERT INTO "Entity" ("id", "name", "entity")
    VALUES (${row.ownerA},
      'Owner A',
      'Owner'),
      (${row.ownerB},
      'Owner B',
      'Owner'),
      (${row.revisionA},
      'Revision A',
      'Revision'),
      (${row.orphanRevision},
      'Orphan revision',
      'Revision'),
      (${row.validDocument},
      'Valid document',
      'Document'),
      (${row.invalidChildDocument},
      'Invalid child document',
      'Document'),
      (${row.invalidParentDocument},
      'Invalid parent document',
      'Document'),
      (${row.orphanDocument},
      'Orphan document',
      'Document'),
      (${row.guardedWorkspace},
      'Guarded workspace',
      'GuardedWorkspace')
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
    VALUES (${row.validDocument},
      'Valid',
      'ok'),
      (${row.invalidChildDocument},
      'Invalid child',
      'ok'),
      (${row.invalidParentDocument},
      'Invalid parent',
      'bad'),
      (${row.orphanDocument},
      'Orphan',
      'ok')
  `
  await sql`
    INSERT INTO "Document" ("id", "flag", "note", "owner.id", "revision.id")
    VALUES (${row.validDocument},
      TRUE,
      'note',
      ${row.ownerA},
      ${row.revisionA}),
      (${row.invalidChildDocument},
      FALSE,
      'note',
      ${row.ownerA},
      ${row.revisionA}),
      (${row.invalidParentDocument},
      TRUE,
      'note',
      ${row.ownerA},
      ${row.revisionA}),
      (${row.orphanDocument},
      TRUE,
      'note',
      ${row.ownerA},
      ${row.orphanRevision})
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
 * Run one authorization test as the restricted app role on the one fixture.
 * @param label - Fixture acquisition label.
 * @param actor - Verified actor identity, or null for anonymous.
 * @param callback - Work using the app-role transaction and entity query capability.
 * @returns The callback result after rollback.
 */
export async function withAuthorizationDatabase<T>(
  label: string,
  actor: string | null,
  callback: (database: AuthorizationDatabase) => Promise<T>,
): Promise<T> {
  const fixture = await useDatabaseFixture(label)
  return runAsActor({ id: actor }, () => fixture.testWith(
    authorizationGraph.definitions,
    async sql => {
      await sql.unsafe(
        `set local search_path to ${quoteIdentifier(fixture.authorizationSchema)}, public, basis, pg_temp`,
      ).simple()
      await sql.unsafe(`set local role ${quoteIdentifier(AUTHORIZATION_APP_ROLE)}`).simple()
      await sql`
        SELECT set_config('actor.id', ${actor ?? ''}, TRUE)
      `
      return callback({
        query: <Result = Record<string, unknown>>(entity: string, options: QueryOptions) => (
          queryEntity<Result>(sql, authorizationGraph.definitions, entity, options)
        ),
        sql,
      })
    },
  ))
}

/**
 * Run one validation test through the shared authorization schema.
 * @param label - Fixture acquisition label.
 * @param actor - Verified actor identity, or null for anonymous.
 * @param callback - Work using the app-role transaction.
 * @returns The callback result after rollback.
 */
export async function withValidationDatabase<T>(
  label: string,
  actor: string | null,
  callback: (database: ValidationDatabase) => Promise<T>,
): Promise<T> {
  return withAuthorizationDatabase(label, actor, async database => {
    const tx = async <Result>(work: (sql: MutationDatabase) => Result | Promise<Result>) => {
      const savepoint = database.sql.savepoint as unknown as <Value>(
        callback: (sql: DatabaseTransaction) => Value | Promise<Value>,
      ) => Promise<Value>
      return savepoint(async sql => {
        try {
          const result = await work(sql)
          await validateTransactionState(authorizationGraph.definitions, transactionClient(sql))
          return result
        } catch (error) {
          clearWrittenSubjects(transactionClient(sql))
          throw error
        }
      })
    }
    return callback({
      ...database,
      create: (entity, values) => tx(sql => sql.create(entity, values)),
      delete: (entity, filter) => tx(sql => sql.delete(entity, filter)),
      edit: (entity, filter, changes) => tx(sql => sql.edit(entity, filter, changes)),
      tx,
      upsert: (entity, filter, values) => tx(sql => sql.upsert(entity, filter, values)),
    })
  })
}

/**
 * Ensure the cached schema exists and contains the requested definitions.
 * @param database - Connected fixture pool.
 * @param schema - Stable schema name.
 * @param entities - Canonical definitions.
 * @returns The schema identifier once initialization is complete.
 */
async function ensureSchema(
  database: FixtureDatabase,
  schema: string,
  entities: EntityDefinitions,
): Promise<string> {
  await database.tx(async sql => {
    await sql`
      SELECT pg_advisory_xact_lock(hashtext(${schema}))
    `
    const present = await sql<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schema} ) AS present
    `
    if (present[0]?.present) return

    await sql.unsafe(`create schema ${quoteIdentifier(schema)}`).simple()
    await sql.unsafe(`set local search_path to ${quoteIdentifier(schema)}`).simple()
    await installSchema(sql, entities, { version: `fixture:${schema}` })
    record(`schema ${schema}`)
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
    if (run`docker rm -f ${id}`.exitCode !== 0) succeeded = false
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
