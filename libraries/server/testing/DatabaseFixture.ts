import { run } from 'basis/configuration'
import { Logger } from 'basis/logger'
import { registerRunCleanup, tempDirectory } from 'basis/testing'
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { EntityDefinitions } from '../source/EntityDefinitions'
import { Server } from '../source/Server'

/** Activity-log environment variable used by the lifecycle proof. */
const ACTIVITY_LOG = 'BASIS_DATABASE_ACTIVITY_LOG'

/** Silent logger for the in-process fixture server. */
const silent = new Logger({ silent: true })

/** The Note entity fixture used by ordinary database tests. */
export const noteDefinition = {
  fields: [
    { name: 'id', primaryKey: true, type: 'uuid' },
    { name: 'title', type: 'string' },
    { name: 'active', type: 'boolean' },
    { name: 'score', type: 'number' },
    { name: 'dueOn', type: 'date' },
    { name: 'createdAt', type: 'timestamp' },
  ],
  name: 'Note',
}

/** The Account entity fixture used by ordinary database tests. */
export const accountDefinition = {
  fields: [
    { name: 'id', primaryKey: true, type: 'snowflake' },
    { name: 'name', type: 'string' },
  ],
  name: 'Account',
}

/** The NumberRow entity fixture used by ordinary database tests. */
export const numberRowDefinition = {
  fields: [
    { name: 'id', primaryKey: true, type: 'uuid' },
    { name: 'value', type: 'number' },
  ],
  name: 'NumberRow',
}

/** The nullable QueryRow entity fixture used by predicate tests. */
export const queryRowDefinition = {
  fields: [
    { name: 'id', primaryKey: true, type: 'uuid' },
    { name: 'active', type: 'boolean' },
    { name: 'externalId', type: 'snowflake' },
    { name: 'rank', type: 'number' },
    { name: 'score', type: 'number' },
    { name: 'title', type: 'string' },
  ],
  name: 'QueryRow',
}

/** The User entity used by reference-field query tests. */
export const userDefinition = {
  fields: [
    { name: 'id', primaryKey: true, type: 'snowflake' },
    { name: 'name', type: 'string' },
  ],
  name: 'User',
}

/** The Article entity used by reference-field query tests. */
export const articleDefinition = {
  fields: [
    { name: 'id', primaryKey: true, type: 'uuid' },
    { name: 'title', type: 'string' },
    { column: 'ownerId', name: 'owner', target: 'User', type: 'entity' },
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
 * await the same process-wide promise. Teardown is registered with the testing
 * preload, so it runs once after the suite and on signal shutdown.
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
  const install = tempDirectory('basis-database-fixture-')
  scope.pending = { install, service }
  const server = startForInstall(
    new Server().root(install).database({ entities: sharedEntities }),
    install,
  )

  try {
    await server.ready()
    record(`start ${service} ${install} ${process.pid}`)
    return { entities: sharedEntities, install, server, service }
  } catch (error) {
    await server.shutdown()
    scope.serviceRemoved = removeService(install)
    throw error
  }
}

/**
 * Stop the shared fixture and remove its managed service exactly once.
 * @param scope - The process-wide fixture registry.
 */
async function cleanupFixture(scope: DatabaseFixtureRegistry): Promise<void> {
  if (scope.stopped) return
  record('cleanup')
  scope.stopped = true
  const fixture = await scope.fixture?.catch(() => undefined)
  if (fixture) await fixture.server.shutdown()

  const service = fixture ?? scope.pending
  if (service) removeManagedService(scope, service)
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
