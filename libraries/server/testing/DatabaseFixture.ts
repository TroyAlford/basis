import { run, runAsync } from 'basis/configuration'
import { SQL as BunSQL } from 'bun'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { seedImage } from '../../../testing/database/seed/image'
import { registerRunCleanup } from '../../testing/lifecycle'
import { currentActor } from '../source/ActorContext'
import type { Database, DatabaseTransaction, QueryOptions } from '../source/Database'
import { queryEntity, transactionWithMutations } from '../source/Database'
import { EntityDefinitions } from '../source/EntityDefinitions'
import { managedDatabaseIdentity } from '../source/ManagedPostgresService'
import type { CreateResult, DeleteResult, EditResult, MutationFilter, MutationValues, UpsertResult } from '../source/Mutation'
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
      return callback(transactionWithMutations(this.#entities, tx))
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
  /** Installation whose seeded service is shared. */
  readonly install: string,
  /** Resolve or create the schema for one exact entity definition set. */
  readonly schemaFor: (entities: EntityDefinitions) => Promise<string>,
  /** Fixture service name used for cleanup and activity evidence. */
  readonly service: string,
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
      database,
      entities: sharedEntities,
      install,
      schemaFor,
      service,
    }
    await fixture.schemaFor(sharedEntities)
    record(`${existing ? 'attach' : 'start'} ${service} ${install} ${process.pid}`)
    if (!existing) record(`canonical ${service} ${install} ${process.pid}`)
    return fixture
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
