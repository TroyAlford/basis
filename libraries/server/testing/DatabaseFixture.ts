import { run } from 'basis/configuration'
import { Logger } from 'basis/logger'
import { registerRunCleanup } from 'basis/testing'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { EntityDefinitions } from '../source/EntityDefinitions'
import { Server } from '../source/Server'

/** Activity-log environment variable used by the lifecycle proof. */
const ACTIVITY_LOG = 'BASIS_DATABASE_ACTIVITY_LOG'

/** Silent logger for the in-process fixture server. */
const silent = new Logger({ silent: true })

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

/** Entities available from the shared ordinary database server. */
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

/** A started in-process database fixture. */
export interface DatabaseFixture {
  /** Entity definitions attached to the shared server. */
  readonly entities: EntityDefinitions,
  /** Installation whose managed service is shared. */
  readonly install: string,
  /** Resolve or create the schema for one exact entity definition set. */
  readonly schemaFor: (entities: EntityDefinitions) => Promise<string>,
  /** Started server owning the shared managed service. */
  readonly server: Server,
  /** Managed service name used for cleanup and activity evidence. */
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
  /** Whether the managed service has been removed. */
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
 * The first caller in any test file starts one in-process server and managed
 * PostgreSQL service. Later callers, including callers in other test files,
 * await the same process-wide promise. The pool closes at run cleanup; the
 * managed service stays available for the next run unless the fixture is
 * explicitly configured as ephemeral.
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
 * Start the shared fixture server and managed service.
 * @param scope - The process-wide fixture registry.
 * @returns The running fixture.
 */
async function startFixture(scope: DatabaseFixtureRegistry): Promise<DatabaseFixture> {
  const service = `basis-database-fixture-${randomUUID()}`
  const install = fixtureInstall()
  const existing = containers(install).length > 0
  const schemas = new Map<string, Promise<string>>()
  scope.pending = { install, service }
  const server = startForInstall(
    new Server().root(install).database({ entities: sharedEntities }),
    install,
  )
  const schemaFor = (entities: EntityDefinitions): Promise<string> => {
    const schema = fixtureSchemaName(entities)
    let pending = schemas.get(schema)
    if (!pending) {
      pending = ensureSchema(server, schema, entities)
      schemas.set(schema, pending)
      void pending.catch(() => schemas.delete(schema))
    }
    return pending
  }

  try {
    await server.ready()
    const fixture: DatabaseFixture = {
      entities: sharedEntities,
      install,
      schemaFor,
      server,
      service,
    }
    await fixture.schemaFor(sharedEntities)
    record(`${existing ? 'attach' : 'start'} ${service} ${install} ${process.pid}`)
    return fixture
  } catch (error) {
    await server.shutdown()
    if (!existing || Bun.env.BASIS_DATABASE_FIXTURE_EPHEMERAL === '1') {
      scope.serviceRemoved = removeService(install)
    }
    throw error
  }
}

/**
 * Close the fixture pool; remove the managed service only for ephemeral runs.
 * @param scope - The process-wide fixture registry.
 */
async function cleanupFixture(scope: DatabaseFixtureRegistry): Promise<void> {
  if (scope.stopped) return
  record('cleanup')
  scope.stopped = true
  const fixture = await scope.fixture?.catch(() => undefined)
  if (fixture) await fixture.server.shutdown()

  const service = fixture ?? scope.pending
  if (service && Bun.env.BASIS_DATABASE_FIXTURE_EPHEMERAL === '1') {
    removeManagedService(scope, service)
  }
}

/**
 * Remove the managed service synchronously when the process exits.
 *
 * The async run cleanup covers normal completion and failures. This exit
 * handler is the signal safety net for in-process resources: it runs before the
 * process closes and performs the synchronous container/volume removal even if
 * an interrupt prevents the async cleanup from finishing.
 * @param scope - The process-wide fixture registry.
 */
function cleanupOnExit(scope: DatabaseFixtureRegistry): void {
  if (Bun.env.BASIS_DATABASE_FIXTURE_EPHEMERAL !== '1') return
  const service = scope.value ?? scope.pending
  if (service) removeManagedService(scope, service)
}

/**
 * Remove a fixture's managed service exactly once.
 * @param scope - The process-wide fixture registry.
 * @param service - Service identity to remove.
 * @param service.install - Installation root used for container ownership.
 * @param service.service - Managed service name recorded in the activity log.
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
 * Start a server with a specific installation as the managed database identity.
 * @param server - The configured server.
 * @param install - The installation working directory.
 * @returns The started server.
 */
function startForInstall(server: Server, install: string): Server {
  const previous = process.cwd()
  process.chdir(install)
  try {
    return server.start({ development: true, hostname: '127.0.0.1', logger: silent, port: 0 })
  } finally {
    process.chdir(previous)
  }
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
  const hash = createHash('sha256').update(entities.ddl.join('\n')).digest('hex').slice(0, 16)
  return `basis_fixture_${hash}`
}

/**
 * Ensure the cached schema exists and contains the requested definitions.
 * @param server - Started fixture server.
 * @param schema - Stable schema name.
 * @param entities - Canonical definitions.
 * @returns The schema identifier once initialization is complete.
 */
async function ensureSchema(
  server: Server,
  schema: string,
  entities: EntityDefinitions,
): Promise<string> {
  await server.db.tx(async sql => {
    await sql`
      SELECT pg_advisory_xact_lock(hashtext(${schema}))
    `
    const present = await sql<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schema} ) AS present
    `
    if (present[0]?.present) return

    await sql.unsafe(`create schema ${quoteIdentifier(schema)}`).simple()
    await sql.unsafe(`set local search_path to ${quoteIdentifier(schema)}`).simple()
    await entities.createTables(sql)
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
 * Find containers owned by a managed installation.
 * @param install - The installation root used in the ownership label.
 * @returns The container ids.
 */
export function containers(install: string): readonly string[] {
  return run`docker ps -aq --filter ${`label=basis.install=${install}`}`.lines
}

/**
 * Remove the containers and durable volume for a managed installation and
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
