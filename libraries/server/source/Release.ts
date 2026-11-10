import { SQL as BunSQL } from 'bun'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { canonicalDataDigest } from './CanonicalData'
import type { Graph } from './Graph'
import { MANAGED_APP_ROLE, ManagedPostgresService } from './ManagedPostgresService'
import type { PostgresBackup, PostgresCleanupWarning, PostgresVerification } from './PostgresOperations'
import { ManagedPostgresOperations } from './PostgresOperations'
import type { MigrationArtifact } from './Schema'
import { DDL, physicalHash, verifyMigrationArtifact } from './Schema'

/** The checked-in release manifest filename. */
const MANIFEST = 'manifest.json'
/** The release lock filename inside `.basis/database`. */
const LOCK = 'release.lock'

/** The checked-in migration release manifest. */
export interface MigrationManifest {
  /** Ordered migration filenames belonging to this application release. */
  readonly migrations: readonly string[],
  /** Application release version. */
  readonly version: string,
}

/** One loaded, checksum-validated migration release. */
export interface LoadedRelease {
  /** Manifest metadata. */
  readonly manifest: MigrationManifest,
  /** Ordered reviewed artifacts. */
  readonly migrations: readonly MigrationArtifact[],
}

/** One migration row read from the candidate ledger. */
interface LedgerRow {
  /** Applied artifact checksum. */
  readonly checksum: string,
  /** Ledger status. */
  readonly status: string,
  /** Applied artifact version. */
  readonly version: string,
}

/** The current release plan. */
export interface ReleasePlan {
  /** Artifacts already applied to the live database. */
  readonly applied: readonly MigrationArtifact[],
  /** Artifacts waiting for a release. */
  readonly pending: readonly MigrationArtifact[],
  /** Target complete physical hash. */
  readonly targetHash: string,
  /** Whether the live database already matches the requested release. */
  readonly upToDate: boolean,
  /** Application release version. */
  readonly version: string,
}

/** One completed release. */
export interface ReleaseResult {
  /** Migration versions applied by this release, empty for a no-op release. */
  readonly applied: readonly string[],
  /** Automatic pre-release recovery point, when the database had a baseline. */
  readonly backup?: PostgresBackup,
  /** Whether the live database changed. */
  readonly changed: boolean,
  /** Post-commit cleanup warnings. */
  readonly warnings: readonly PostgresCleanupWarning[],
}

/** Options for one host-run database release. */
export interface DatabaseReleaseOptions {
  /** Optional backup directory; defaults to `.basis/backups` below installation. */
  readonly backupDirectory?: string,
  /** Current application Graph. */
  readonly graph: Graph,
  /** Installation root; defaults to the current working directory. */
  readonly installation?: string,
  /** Reviewed migrations directory containing `manifest.json`. */
  readonly migrations: string,
}

/**
 * Load and validate a checked-in migration release.
 * @param directory - Directory containing `manifest.json` and migration files.
 * @param graph - Current application Graph.
 * @returns The ordered release.
 */
export async function loadRelease(directory: string, graph: Graph): Promise<LoadedRelease> {
  const root = resolve(directory)
  const parsed = JSON.parse(await readFile(join(root, MANIFEST), 'utf8')) as unknown
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Release manifest is not an object')
  const manifest = parsed as Partial<MigrationManifest>
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    throw new Error('Release manifest version is required')
  }
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length === 0) {
    throw new Error('Release manifest migrations must be a non-empty array')
  }
  const seen = new Set<string>()
  const seenChecksums = new Set<string>()
  const migrations: MigrationArtifact[] = []
  for (const filename of manifest.migrations) {
    if (
      typeof filename !== 'string'
      || basename(filename) !== filename
      || !filename.endsWith('.json')
    ) {
      throw new Error(`Release migration filename is invalid: ${String(filename)}`)
    }
    if (seen.has(filename)) throw new Error(`Release migration is duplicated: ${filename}`)
    seen.add(filename)
    const artifact = JSON.parse(await readFile(join(root, filename), 'utf8')) as MigrationArtifact
    verifyMigrationArtifact(artifact)
    if (seenChecksums.has(artifact.checksum)) {
      throw new Error(`Release migration checksum is duplicated: ${filename}`)
    }
    seenChecksums.add(artifact.checksum)
    if (artifact.version !== filename.slice(0, -'.json'.length)) {
      throw new Error(`Release migration ${filename} has a different version identity`)
    }
    migrations.push(artifact)
  }
  const target = migrations.at(-1) as MigrationArtifact
  const expected = graph.physicalSchema(target.appRole, target.superuser)
  if (physicalHash(expected) !== target.targetHash) {
    throw new Error(
      'Release migrations do not reach the configured Graph; ' +
      'review a migration for the complete proposed model',
    )
  }
  return { manifest: manifest as MigrationManifest, migrations }
}

/**
 * Host-run versioned release coordinator for one managed installation.
 *
 * The caller first takes the application offline. The coordinator backs up the
 * live database, clones it to disposable candidate storage, applies only the
 * reviewed artifacts to that candidate, verifies the complete Graph/ledger/data
 * contract, and only then promotes the candidate through the managed service.
 */
export class DatabaseRelease {
  readonly #backupDirectory: string
  readonly #graph: Graph
  readonly #installation: string
  readonly #migrations: string
  readonly #service: ManagedPostgresService

  /**
   * Build a release coordinator.
   * @param options - Graph, migration directory, and installation options.
   */
  constructor(options: DatabaseReleaseOptions) {
    this.#installation = resolve(options.installation ?? process.cwd())
    this.#graph = options.graph
    this.#migrations = resolve(options.migrations)
    this.#service = new ManagedPostgresService(this.#installation)
    this.#backupDirectory = resolve(
      options.backupDirectory ?? join(this.#installation, '.basis', 'backups'),
    )
  }

  /**
   * Inspect the current release state without mutating the database.
   * @returns The applied and pending migration plan.
   */
  async plan(): Promise<ReleasePlan> {
    const release = await loadRelease(this.#migrations, this.#graph)
    const connection = await this.#service.ensure(false)
    const sql = new BunSQL(connection.ownerUrl)
    try {
      await sql.connect()
      return await this.#plan(sql, release)
    } finally {
      await sql.close()
    }
  }

  /**
   * Apply the checked-in release through a disposable, verified candidate.
   *
   * The caller must first take the application offline. The live database is
   * never mutated before a verified candidate is ready for cutover.
   * @returns The committed release result.
   */
  async apply(): Promise<ReleaseResult> {
    const release = await loadRelease(this.#migrations, this.#graph)
    const unlock = await this.#lock()
    let sourceSql: BunSQL | null = null
    let candidateSql: BunSQL | null = null
    let candidate: { container: string, volume: string } | null = null
    let promoting = false
    let sourceStopped = false
    try {
      const connection = await this.#service.ensure(false)
      sourceSql = new BunSQL(connection.ownerUrl)
      await sourceSql.connect()
      const plan = await this.#plan(sourceSql, release)
      const target = plan.pending.at(-1) ?? plan.applied.at(-1) as MigrationArtifact
      const previous = plan.applied.at(-1)
      const backupOptions = {
        artifact: previous,
        backupDirectory: this.#backupDirectory,
        installation: this.#installation,
      }
      const backup = previous
        ? await new ManagedPostgresOperations(backupOptions, this.#service).backup()
        : undefined
      if (plan.upToDate) {
        return {
          applied: [],
          ...(backup === undefined ? {} : { backup }),
          changed: false,
          warnings: [],
        }
      }

      const image = await this.#service.containerImage()
      await sourceSql.close()
      sourceSql = null
      const state = await this.#service.containerState()
      if (state === 'running') {
        await this.#service.stopContainer()
        sourceStopped = true
      }
      const candidateVolume = `basis-release-volume-${randomUUID()}`
      const candidateContainer = `basis-release-${randomUUID()}`
      candidate = { container: candidateContainer, volume: candidateVolume }
      await this.#service.createVolume(candidateVolume)
      await this.#service.copyVolume(this.#service.volumeName, candidateVolume, image)
      const secret = await this.#service.secret(false)
      await this.#service.createContainer(candidateContainer, candidateVolume, image, secret.file)
      await this.#service.waitReady(candidateContainer)
      const port = await this.#service.publishedPort(candidateContainer)
      const ownerUrl = this.#service.databaseUrl('basis', secret.password, port)
      await this.#service.provisionApplicationRole(
        ownerUrl,
        target.appRole ?? MANAGED_APP_ROLE,
        port,
      )
      candidateSql = new BunSQL(ownerUrl)
      await candidateSql.connect()
      const candidatePlan = await this.#plan(candidateSql, release)
      if (candidatePlan.applied.length !== plan.applied.length) {
        throw new Error('Candidate ledger does not match the live release baseline')
      }
      for (const artifact of candidatePlan.pending) {
        await DDL.apply(candidateSql, artifact)
        const readiness = await DDL.readiness(candidateSql, artifact)
        if (!readiness.ready) {
          throw new Error(`Candidate migration ${artifact.version} is not ready: ${readiness.discrepancies.join('; ')}`)
        }
      }
      const readiness = await DDL.readiness(candidateSql, target)
      if (!readiness.ready) {
        throw new Error(`Candidate is not ready: ${readiness.discrepancies.join('; ')}`)
      }
      const ledger = await this.#ledger(candidateSql)
      const expected = release.migrations.map(artifact => artifact.checksum)
      if (ledger.length !== expected.length || ledger.some((row, index) => row.checksum !== expected[index])) {
        throw new Error('Candidate migration ledger does not contain the complete release history')
      }
      if (backup) {
        const digest = await canonicalDataDigest(candidateSql)
        if (digest !== backup.dataDigest) {
          throw new Error('Candidate canonical User/Role data does not match the release backup')
        }
      }
      await candidateSql.close()
      candidateSql = null
      const targetVerification: PostgresVerification = {
        artifact: target,
        ...(backup === undefined ? {} : { dataDigest: backup.dataDigest }),
      }
      const recoveryVerification: PostgresVerification | null = previous && backup
        ? { artifact: previous, dataDigest: backup.dataDigest }
        : null
      promoting = true
      const warnings = await new ManagedPostgresOperations({
        artifact: target,
        backupDirectory: this.#backupDirectory,
        installation: this.#installation,
      }, this.#service).promoteCandidate(
        candidate,
        image,
        recoveryVerification,
        targetVerification,
      )
      return {
        applied: plan.pending.map(artifact => artifact.version),
        ...(backup === undefined ? {} : { backup }),
        changed: true,
        warnings,
      }
    } catch (error) {
      await sourceSql?.close().catch(() => undefined)
      await candidateSql?.close().catch(() => undefined)
      if (!promoting && candidate) {
        await this.#service.removeContainer(candidate.container).catch(() => undefined)
        await this.#service.removeVolume(candidate.volume).catch(() => undefined)
      }
      if (!promoting && sourceStopped) {
        await this.#service.startContainer().catch((restartError: unknown) => {
          throw new AggregateError(
            [error, restartError],
            'Database release failed and the original source could not be restarted',
            { cause: restartError },
          )
        })
      }
      throw error
    } finally {
      await sourceSql?.close().catch(() => undefined)
      await candidateSql?.close().catch(() => undefined)
      await unlock()
    }
  }

  /**
   * Build a plan from an existing owner connection.
   * @param sql - Administrative connection.
   * @param release - Loaded release.
   * @returns The current plan.
   */
  async #plan(sql: BunSQL, release: LoadedRelease): Promise<ReleasePlan> {
    const ledger = await this.#ledger(sql)
    let applied = 0
    for (const row of ledger) {
      const artifact = release.migrations[applied]
      if (!artifact || row.checksum !== artifact.checksum || row.status !== 'applied') {
        throw new Error('Live migration ledger is incomplete, out of order, or contains a failed migration')
      }
      applied += 1
    }
    const appliedArtifacts = release.migrations.slice(0, applied)
    if (appliedArtifacts.length > 0) {
      const last = appliedArtifacts.at(-1) as MigrationArtifact
      const readiness = await DDL.readiness(sql, last)
      if (!readiness.ready) {
        throw new Error(
          `Live database has drifted from migration ${last.version}: ` +
          readiness.discrepancies.join('; '),
        )
      }
    } else {
      const actual = await DDL.introspect(sql)
      if (actual.tables.some(table => table.name !== 'basis.schema_migration')) {
        throw new Error('Live database has an unmanaged schema; install through a reviewed migration first')
      }
    }
    const target = release.migrations.at(-1) as MigrationArtifact
    return {
      applied: appliedArtifacts,
      pending: release.migrations.slice(applied),
      targetHash: target.targetHash,
      upToDate: applied === release.migrations.length,
      version: release.manifest.version,
    }
  }

  /**
   * Read the ordered migration ledger, if it exists.
   * @param sql - Owner connection.
   * @returns Applied ledger rows.
   */
  async #ledger(sql: BunSQL): Promise<readonly LedgerRow[]> {
    const [present] = await sql<{ present: boolean }[]>`
      SELECT to_regclass('basis.schema_migration') IS NOT NULL AS present
    `
    if (!present?.present) return []
    return await sql<LedgerRow[]>`
      SELECT version, checksum, status
      FROM basis.schema_migration
      ORDER BY applied_at, id
    `
  }

  /**
   * Acquire the host release lock, rejecting live or concurrent releases.
   * @returns The unlock callback.
   */
  async #lock(): Promise<() => Promise<void>> {
    const directory = join(this.#installation, '.basis', 'database')
    await mkdir(directory, { mode: 0o700, recursive: true })
    const file = join(directory, LOCK)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(file, 'wx', 0o600)
        try {
          await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`)
        } finally {
          await handle.close()
        }
        return async () => { await unlink(file).catch(() => undefined) }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const owner = Number((await readFile(file, 'utf8')).split('\n')[0])
        if (Number.isInteger(owner) && owner > 0 && await alive(owner)) {
          throw new Error(
            `Database release is already locked by process ${owner}`,
            { cause: error },
          )
        }
        await unlink(file).catch(() => undefined)
      }
    }
    throw new Error('Database release lock could not be acquired')
  }
}

/**
 * Whether a process is still alive on this host.
 * @param pid - Process id.
 * @returns `true` when the process exists.
 */
async function alive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
