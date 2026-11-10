import { SQL as BunSQL } from 'bun'
import { randomUUID } from 'node:crypto'
import { access, mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
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

/** Stable machine codes for release outcomes. */
export type ReleaseErrorCode =
  | 'MIGRATION_FAILED'
  | 'RELEASE_BACKUP_FAILED'
  | 'RELEASE_CUTOVER_FAILED'
  | 'RELEASE_INVALID'
  | 'RELEASE_LOCKED'
  | 'RELEASE_PLAN_FAILED'
  | 'RELEASE_STATE_INVALID'
  | 'RELEASE_TRANSIENT'
  | 'RELEASE_VERIFICATION_FAILED'

/** Durable, controller-readable failure classification for one release version. */
export interface ReleaseFailure {
  /** Recovery point captured before the failed attempt, when available. */
  readonly backup?: PostgresBackup,
  /** Stable machine code. */
  readonly code: ReleaseErrorCode,
  /** Human-readable diagnostic. */
  readonly message: string,
  /** Failure timestamp. */
  readonly occurredAt: string,
  /** Cutover phase that failed. */
  readonly phase: string,
  /** Whether a later retry may reasonably succeed. */
  readonly retryable: boolean,
  /** Approved target physical hash. */
  readonly targetHash: string,
  /** Application release version. */
  readonly version: string,
}

/** One coded release failure with durable classification. */
export class ReleaseError extends Error {
  /** Durable failure record. */
  readonly failure: ReleaseFailure
  /** Stable machine code. */
  readonly code: ReleaseErrorCode

  /**
   * Build a release error.
   * @param failure - Durable classification.
   * @param cause - Original failure.
   */
  constructor(failure: ReleaseFailure, cause?: unknown) {
    super(failure.message, cause === undefined ? undefined : { cause })
    this.name = 'ReleaseError'
    this.failure = failure
    this.code = failure.code
  }

  /**
   * Recovery point captured before the failed attempt.
   * @returns Recorded recovery point, if any.
   */
  get backup(): PostgresBackup | undefined {
    return this.failure.backup
  }

  /**
   * Cutover phase that failed.
   * @returns Failed release phase.
   */
  get phase(): string {
    return this.failure.phase
  }

  /**
   * Whether a later retry may reasonably succeed.
   * @returns Whether the failure is retryable.
   */
  get retryable(): boolean {
    return this.failure.retryable
  }

  /**
   * Approved target physical hash.
   * @returns Approved target physical hash.
   */
  get targetHash(): string {
    return this.failure.targetHash
  }

  /**
   * Application release version.
   * @returns Application release version.
   */
  get version(): string {
    return this.failure.version
  }
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
    let release: LoadedRelease
    try {
      release = await loadRelease(this.#migrations, this.#graph)
    } catch (error) {
      const failure = this.#createFailure('unknown', '', 'load', error)
      throw new ReleaseError(failure, error)
    }
    let unlock: (() => Promise<void>) | null = null
    let sourceSql: BunSQL | null = null
    let candidateSql: BunSQL | null = null
    let candidate: { container: string, volume: string } | null = null
    let promoting = false
    let sourceStopped = false
    let phase = 'plan'
    let plan: ReleasePlan | null = null
    let backup: PostgresBackup | undefined
    try {
      const finalTargetHash = release.migrations.at(-1)?.targetHash ?? ''
      const recordedFailure = await this.failure()
      if (
        recordedFailure
        && recordedFailure.version === release.manifest.version
        && recordedFailure.targetHash === finalTargetHash
        && !recordedFailure.retryable
      ) {
        throw new ReleaseError(recordedFailure)
      }
      phase = 'lock'
      unlock = await this.#lock()
      const connection = await this.#service.ensure(false)
      sourceSql = new BunSQL(connection.ownerUrl)
      await sourceSql.connect()
      phase = 'plan'
      plan = await this.#plan(sourceSql, release)
      if (plan.upToDate) {
        await this.clearFailure().catch(() => undefined)
        return { applied: [], changed: false, warnings: [] }
      }
      const target = (plan.pending.at(-1) ?? plan.applied.at(-1)) as MigrationArtifact
      const previousFailure = await this.failure()
      let reusableBackup: PostgresBackup | undefined
      if (
        previousFailure
        && previousFailure.version === release.manifest.version
        && previousFailure.targetHash === plan.targetHash
      ) {
        if (!previousFailure.retryable) throw new ReleaseError(previousFailure)
        if (previousFailure.backup && await this.#backupExists(previousFailure.backup)) {
          reusableBackup = previousFailure.backup
        }
      }
      phase = 'backup'
      const previous = plan.applied.at(-1)
      const backupOptions = {
        artifact: previous,
        backupDirectory: this.#backupDirectory,
        installation: this.#installation,
      }
      backup = reusableBackup ?? (previous
        ? await new ManagedPostgresOperations(backupOptions, this.#service).backup()
        : undefined)

      phase = 'staging'
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
      phase = 'migration'
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
      phase = 'verification'
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
      phase = 'cutover'
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
      phase = 'commit'
      await this.clearFailure().catch(() => undefined)
      return {
        applied: plan.pending.map(artifact => artifact.version),
        ...(backup === undefined ? {} : { backup }),
        changed: true,
        warnings,
      }
    } catch (error) {
      if (error instanceof ReleaseError) throw error
      await sourceSql?.close().catch(() => undefined)
      await candidateSql?.close().catch(() => undefined)
      if (!promoting && candidate) {
        await this.#service.removeContainer(candidate.container).catch(() => undefined)
        await this.#service.removeVolume(candidate.volume).catch(() => undefined)
      }
      let failure = error
      if (!promoting && sourceStopped) {
        await this.#service.startContainer().catch((restartError: unknown) => {
          failure = new AggregateError(
            [error, restartError],
            'Database release failed and the original source could not be restarted',
            { cause: restartError },
          )
        })
      }
      const record = this.#createFailure(
        release.manifest.version,
        plan?.targetHash ?? '',
        phase,
        failure,
        backup,
      )
      if (phase !== 'lock') await this.#writeFailure(record).catch(() => undefined)
      throw new ReleaseError(record, error)
    } finally {
      await sourceSql?.close().catch(() => undefined)
      await candidateSql?.close().catch(() => undefined)
      await unlock?.()
    }
  }

  /**
   * Read the durable failure record for the installation.
   * @returns The failure record, or null when absent.
   */
  async failure(): Promise<ReleaseFailure | null> {
    let raw: string
    try {
      raw = await readFile(this.#failurePath(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (error) {
      throw new ReleaseError({
        code: 'RELEASE_STATE_INVALID',
        message: 'Database release failure record is malformed',
        occurredAt: new Date().toISOString(),
        phase: 'failure-record',
        retryable: false,
        targetHash: '',
        version: 'unknown',
      }, error)
    }
    if (typeof value !== 'object' || value === null) {
      throw new ReleaseError({
        code: 'RELEASE_STATE_INVALID',
        message: 'Database release failure record is malformed',
        occurredAt: new Date().toISOString(),
        phase: 'failure-record',
        retryable: false,
        targetHash: '',
        version: 'unknown',
      })
    }
    return value as ReleaseFailure
  }

  /**
   * Clear the durable failure record after a controller acknowledges it.
   */
  async clearFailure(): Promise<void> {
    await rm(this.#failurePath(), { force: true })
  }

  /**
   * Classify and persist a release failure.
   * @param version - Release version.
   * @param targetHash - Proposed target hash.
   * @param phase - Release phase.
   * @param error - Original failure.
   * @param backup - Recovery point captured before failure.
   * @returns Durable failure record.
   */
  #createFailure(
    version: string,
    targetHash: string,
    phase: string,
    error: unknown,
    backup?: PostgresBackup,
  ): ReleaseFailure {
    const classification = phase === 'load'
      ? ['RELEASE_INVALID', false] as const
      : phase === 'lock'
        ? ['RELEASE_LOCKED', true] as const
        : phase === 'plan'
          ? ['RELEASE_PLAN_FAILED', false] as const
          : phase === 'backup'
            ? ['RELEASE_BACKUP_FAILED', true] as const
            : phase === 'staging'
              ? ['RELEASE_TRANSIENT', true] as const
              : phase === 'migration'
                ? ['MIGRATION_FAILED', false] as const
                : phase === 'verification'
                  ? ['RELEASE_VERIFICATION_FAILED', false] as const
                  : phase === 'cutover'
                    ? ['RELEASE_CUTOVER_FAILED', true] as const
                    : ['RELEASE_STATE_INVALID', false] as const
    return {
      ...(backup === undefined ? {} : { backup }),
      code: classification[0],
      message: error instanceof Error ? error.message : String(error),
      occurredAt: new Date().toISOString(),
      phase,
      retryable: classification[1],
      targetHash,
      version,
    }
  }

  /**
   * Persist the failure record atomically.
   * @param failure - Failure record.
   */
  async #writeFailure(failure: ReleaseFailure): Promise<void> {
    const file = this.#failurePath()
    const temporary = `${file}.${randomUUID()}`
    await mkdir(join(this.#installation, '.basis', 'database'), { mode: 0o700, recursive: true })
    await writeFile(temporary, `${JSON.stringify(failure, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, file)
  }

  /**
   * Resolve the durable failure record path.
   * @returns Absolute path.
   */
  #failurePath(): string {
    return join(this.#installation, '.basis', 'database', 'release-failure.json')
  }

  /**
   * Whether a recorded backup still has both its archive and manifest.
   * @param backup - Backup record.
   * @returns Whether the recovery point is present.
   */
  async #backupExists(backup: PostgresBackup): Promise<boolean> {
    try {
      await access(backup.path)
      await access(backup.manifest)
      return true
    } catch {
      return false
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
