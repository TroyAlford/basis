import { runAsync } from 'basis/configuration'
import { SQL as BunSQL } from 'bun'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { MANAGED_APP_ROLE, ManagedPostgresService } from './ManagedPostgresService'
import type { MigrationArtifact } from './Schema'
import { DDL } from './Schema'

/** Managed PostgreSQL database name. */
const DATABASE = 'basis'
/** Backup manifest schema version. */
const MANIFEST_VERSION = 1

/** Options for managed operations. */
export interface PostgresOperationsOptions {
  /** Approved physical/migration artifact corresponding to the backed-up version. */
  readonly artifact: MigrationArtifact,
  /** Optional backup directory; defaults to `.basis/backups` below installation. */
  readonly backupDirectory?: string,
  /** Installation root; defaults to the current working directory. */
  readonly installation?: string,
}

/** One completed database backup. */
export interface PostgresBackup {
  /** Approved artifact version captured with the backup. */
  readonly artifactVersion: string,
  /** SHA-256 archive digest. */
  readonly checksum: string,
  /** Backup creation timestamp. */
  readonly createdAt: string,
  /** Canonical User/Role data digest captured with the backup. */
  readonly dataDigest: string,
  /** Source image recorded in the manifest. */
  readonly image: string,
  /** Sidecar manifest path. */
  readonly manifest: string,
  /** Backup archive path. */
  readonly path: string,
}

/** Restore inputs. */
export interface PostgresRestoreOptions {
  /** Target image; defaults to the source image recorded in the backup. */
  readonly image?: string,
}

/** Restore verification result. */
export interface PostgresRestoreResult {
  /** Approved artifact version verified on the restored database. */
  readonly artifactVersion: string,
  /** Canonical User/Role data digest verified after restore. */
  readonly dataDigest: string,
  /** Image used for the disposable restore. */
  readonly image: string,
  /** Whether the verified restore completed. */
  readonly verified: true,
}

/** One post-commit cleanup warning. */
export interface PostgresCleanupWarning {
  /** Cleanup failure message. */
  readonly message: string,
  /** Resource left behind for later cleanup. */
  readonly resource: string,
}

/** Upgrade result. */
export interface PostgresUpgradeResult {
  /** Recovery point taken before cutover. */
  readonly backup: PostgresBackup,
  /** Target image now running. */
  readonly image: string,
  /** Previous source image. */
  readonly previousImage: string,
  /** Non-fatal post-commit cleanup obligations. */
  readonly warnings: readonly PostgresCleanupWarning[],
}

/** Rollback result. */
export interface PostgresRollbackResult {
  /** Non-fatal post-commit cleanup obligations. */
  readonly warnings: readonly PostgresCleanupWarning[],
}

/** One immutable backup manifest. */
interface BackupManifest {
  /** Approved physical/migration artifact for the backup version. */
  readonly artifact: MigrationArtifact,
  /** SHA-256 archive digest. */
  readonly checksum: string,
  /** Backup creation timestamp. */
  readonly createdAt: string,
  /** Canonical User/Role data digest. */
  readonly dataDigest: string,
  /** Source image. */
  readonly image: string,
  /** Manifest schema version. */
  readonly version: 1,
}

/** One disposable restore container. */
interface DisposableRestore {
  /** Container name. */
  readonly container: string,
  /** Volume name. */
  readonly volume: string,
}

/**
 * Host-run PostgreSQL operations for one managed installation.
 *
 * This class never schedules itself and never starts a daemon. It delegates
 * managed container, volume, credential, and application-role ownership to the
 * package-local service shared with `ManagedDatabase`. Each recovery point is
 * verified through `DDL.readiness` and a canonical User/Role data digest before
 * it can become the running source.
 */
export class ManagedPostgresOperations {
  readonly #artifact: MigrationArtifact
  readonly #backupDirectory: string
  readonly #installation: string
  readonly #service: ManagedPostgresService

  /**
   * Build operations for one managed installation.
   * @param options - Installation, backup directory, and approved artifact.
   * @param service - Package-local service seam used by focused tests.
   */
  constructor(options: PostgresOperationsOptions, service?: ManagedPostgresService) {
    this.#installation = resolve(options.installation ?? process.cwd())
    this.#artifact = options.artifact
    this.#service = service ?? new ManagedPostgresService(this.#installation)
    this.#backupDirectory = resolve(
      options.backupDirectory ?? join(this.#installation, '.basis', 'backups'),
    )
  }

  /**
   * Create a verified backup through the administrative owner.
   * @returns The backup artifact metadata.
   * @throws {Error} When the source is missing, the approved artifact is not ready,
   * or canonical User/Role data changes while the archive is being produced.
   */
  async backup(): Promise<PostgresBackup> {
    const state = await this.#service.containerState()
    if (state === 'missing') {
      throw new Error(`Managed PostgreSQL service "${this.#service.containerName}" is missing`)
    }
    const connection = await this.#service.ensure(false)
    const createdAt = new Date().toISOString()
    const stem = `${createdAt.replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`
    const path = join(this.#backupDirectory, `${stem}.dump`)
    const manifest = `${path}.json`
    await mkdir(this.#backupDirectory, { mode: 0o700, recursive: true })
    await chmod(this.#backupDirectory, 0o700)
    await this.#protectDirectory(this.#backupDirectory)
    const sql = new BunSQL(connection.ownerUrl)
    const remote = `/tmp/basis-backup-${randomUUID()}.dump`
    try {
      await sql.connect()
      const readiness = await DDL.readiness(sql, this.#artifact)
      if (!readiness.ready) {
        throw new Error(`Backup source schema is not ready: ${readiness.discrepancies.join('; ')}`)
      }
      const before = await this.#canonicalDigest(sql)
      await this.#docker([
        'docker', 'exec', this.#service.containerName, 'pg_dump', '-U', DATABASE, '-d', DATABASE,
        '--format=custom', '--file', remote,
      ], 'pg_dump failed')
      await this.#docker([
        'docker', 'cp', `${this.#service.containerName}:${remote}`, path,
      ], 'docker cp failed')
      await chmod(path, 0o600)
      await this.#docker([
        'docker', 'exec', this.#service.containerName, 'rm', '-f', remote,
      ], 'backup cleanup failed')
      const after = await this.#canonicalDigest(sql)
      if (before !== after) {
        throw new Error('Canonical User/Role data changed during backup; retry while the application is quiescent')
      }
      const image = await this.#service.containerImage()
      const checksum = createHash('sha256').update(await readFile(path)).digest('hex')
      const record: BackupManifest = {
        artifact: this.#artifact,
        checksum,
        createdAt,
        dataDigest: after,
        image,
        version: MANIFEST_VERSION,
      }
      await writeFile(manifest, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
      return {
        artifactVersion: this.#artifact.version,
        checksum,
        createdAt,
        dataDigest: after,
        image,
        manifest,
        path,
      }
    } catch (error) {
      await rm(path, { force: true })
      await rm(manifest, { force: true })
      throw error
    } finally {
      await sql.close()
    }
  }

  /**
   * Restore into disposable storage and verify the approved schema and data.
   * @param backup - Backup archive path.
   * @param options - Target image override.
   * @returns Verification result after disposal.
   */
  async restore(
    backup: string,
    options: PostgresRestoreOptions = {},
  ): Promise<PostgresRestoreResult> {
    const manifest = await this.#readBackup(backup)
    const image = options.image ?? manifest.image
    const restore = await this.#prepareRestore(manifest, image, backup)
    try {
      return {
        artifactVersion: manifest.artifact.version,
        dataDigest: manifest.dataDigest,
        image,
        verified: true,
      }
    } finally {
      await this.#dispose(restore)
    }
  }

  /**
   * Upgrade managed PostgreSQL through a verified logical recovery point.
   *
   * The caller must stop application pools before invoking this method. The
   * source volume is copied to a recovery volume before it is detached, and is
   * restored before the original failure is rethrown if cutover fails.
   * @param targetImage - Target PostgreSQL image.
   * @returns Recovery point and new image.
   */
  async upgrade(targetImage: string): Promise<PostgresUpgradeResult> {
    const previousImage = await this.#service.containerImage()
    const recovery = await this.backup()
    const manifest = await this.#readBackup(recovery.path)
    const target = await this.#prepareRestore(manifest, targetImage, recovery.path)
    const warnings = await this.#cutover(target, targetImage, manifest, previousImage)
    return { backup: recovery, image: targetImage, previousImage, warnings }
  }

  /**
   * Restore one recovery point into the managed source volume.
   * The caller must stop application pools before invoking this method.
   * @param backup - Backup archive path.
   * @param image - Image for the restored source container; defaults to current.
   * @returns Cleanup warnings for any post-commit resources left behind.
   */
  async rollback(backup: string, image?: string): Promise<PostgresRollbackResult> {
    const manifest = await this.#readBackup(backup)
    const previousImage = await this.#service.containerImage()
    const targetImage = image ?? manifest.image
    const target = await this.#prepareRestore(manifest, targetImage, backup)
    return { warnings: await this.#cutover(target, targetImage, manifest, previousImage) }
  }

  /**
   * Create and verify disposable storage from one backup.
   * @param manifest - Validated backup manifest.
   * @param image - Target image.
   * @param backupPath - Validated archive path.
   * @returns The verified disposable restore handle.
   */
  async #prepareRestore(
    manifest: BackupManifest,
    image: string,
    backupPath: string,
  ): Promise<DisposableRestore> {
    const secret = await this.#service.secret(false)
    const restore = {
      container: `basis-restore-${randomUUID()}`,
      volume: `basis-restore-volume-${randomUUID()}`,
    }
    try {
      await this.#service.createVolume(restore.volume)
      await this.#service.createContainer(
        restore.container,
        restore.volume,
        image,
        secret.file,
      )
      await this.#service.waitReady(restore.container)
      const port = await this.#service.publishedPort(restore.container)
      const ownerUrl = this.#service.databaseUrl(DATABASE, secret.password, port)
      await this.#service.provisionApplicationRole(
        ownerUrl,
        manifest.artifact.appRole ?? MANAGED_APP_ROLE,
        port,
      )
      await this.#docker([
        'docker', 'cp', backupPath, `${restore.container}:/tmp/basis-restore.dump`,
      ], 'backup copy failed')
      await this.#docker([
        'docker', 'exec', restore.container, 'pg_restore', '-U', DATABASE, '-d', DATABASE,
        '--clean', '--if-exists', '/tmp/basis-restore.dump',
      ], 'pg_restore failed')
      await this.#verify(ownerUrl, manifest)
      return restore
    } catch (error) {
      await this.#dispose(restore)
      throw error
    }
  }

  /**
   * Replace the source with a verified target while retaining the old volume.
   * @param restore - Verified disposable restore.
   * @param image - Target image.
   * @param manifest - Recovery point manifest.
   * @param previousImage - Previous source image.
   * @returns Cleanup warnings for any post-commit resources left behind.
   */
  async #cutover(
    restore: DisposableRestore,
    image: string,
    manifest: BackupManifest,
    previousImage: string,
  ): Promise<readonly PostgresCleanupWarning[]> {
    const state = await this.#service.containerState()
    if (state === 'running') await this.#service.stopContainer()
    const recoveryVolume = `${this.#service.volumeName}-recovery-${randomUUID()}`
    let sourceDetached = false
    let sourceCommitted = false
    try {
      await this.#service.createVolume(recoveryVolume)
      await this.#service.copyVolume(this.#service.volumeName, recoveryVolume, previousImage)
      await this.#verifyRecovery(recoveryVolume, previousImage, manifest)
      await this.#service.removeContainer()
      await this.#service.removeVolume()
      await this.#assertDetached()
      sourceDetached = true
      await this.#service.createVolume()
      await this.#service.stopContainer(restore.container)
      await this.#service.removeContainer(restore.container)
      await this.#service.copyVolume(restore.volume, this.#service.volumeName, image)
      const secret = await this.#service.secret(false)
      await this.#service.createContainer(
        this.#service.containerName,
        this.#service.volumeName,
        image,
        secret.file,
      )
      await this.#service.waitReady()
      await this.#verifyService(manifest)
      sourceCommitted = true
      return await this.#cleanupCommitted(restore.volume, recoveryVolume)
    } catch (error) {
      if (sourceCommitted) throw error
      if (!sourceDetached) {
        try {
          await this.#recoverBeforeDetach(recoveryVolume, previousImage, manifest, restore)
        } catch (recoveryError) {
          throw new Error(
            'PostgreSQL cutover failed before detaching the source ' +
            `(${error instanceof Error ? error.message : String(error)}) and recovery failed ` +
            `(${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}); ` +
            `recovery volume "${recoveryVolume}" and candidate volume "${restore.volume}" were preserved`,
            { cause: recoveryError },
          )
        }
        throw error
      }
      try {
        await this.#restoreRecovery(recoveryVolume, previousImage, manifest)
        await this.#service.removeVolume(restore.volume)
        await this.#service.removeVolume(recoveryVolume)
      } catch (rollbackError) {
        throw new Error(
          `PostgreSQL upgrade failed (${error instanceof Error ? error.message : String(error)}) ` +
          `and recovery failed (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}); ` +
          `recovery volume "${recoveryVolume}" and candidate volume "${restore.volume}" were preserved`,
          { cause: rollbackError },
        )
      }
      throw error
    }
  }

  /**
   * Clean up post-commit volumes without turning a successful cutover into failure.
   * @param candidateVolume - Disposable candidate volume.
   * @param recoveryVolume - Preserved source volume copy.
   * @returns Non-fatal cleanup warnings for resources that remain.
   */
  async #cleanupCommitted(
    candidateVolume: string,
    recoveryVolume: string,
  ): Promise<readonly PostgresCleanupWarning[]> {
    const warnings: PostgresCleanupWarning[] = []
    for (const resource of [candidateVolume, recoveryVolume]) {
      try {
        await this.#service.removeVolume(resource)
      } catch (error) {
        warnings.push({
          message: error instanceof Error ? error.message : String(error),
          resource,
        })
      }
    }
    return warnings
  }

  /**
   * Prove the copied recovery volume can start and serve the approved schema.
   * @param recoveryVolume - Copied source volume.
   * @param previousImage - Previous source image.
   * @param manifest - Recovery point manifest.
   */
  async #verifyRecovery(
    recoveryVolume: string,
    previousImage: string,
    manifest: BackupManifest,
  ): Promise<void> {
    const container = `basis-recovery-${randomUUID()}`
    const secret = await this.#service.secret(false)
    try {
      await this.#service.createContainer(container, recoveryVolume, previousImage, secret.file)
      await this.#service.waitReady(container)
      const port = await this.#service.publishedPort(container)
      await this.#verify(this.#service.databaseUrl(DATABASE, secret.password, port), manifest)
    } finally {
      await this.#service.removeContainer(container)
    }
  }

  /**
   * Recover a source that was not yet detached, without discarding its volume.
   * @param recoveryVolume - Proven recovery copy.
   * @param previousImage - Previous source image.
   * @param manifest - Recovery point manifest.
   * @param candidate - Candidate restore to clean up after source recovery.
   */
  async #recoverBeforeDetach(
    recoveryVolume: string,
    previousImage: string,
    manifest: BackupManifest,
    candidate: DisposableRestore,
  ): Promise<void> {
    const hasVolume = await this.#service.volumeExists()
    if (hasVolume) {
      const state = await this.#service.containerState()
      if (state === 'missing') {
        const secret = await this.#service.secret(false)
        await this.#service.createContainer(
          this.#service.containerName,
          this.#service.volumeName,
          previousImage,
          secret.file,
        )
        await this.#service.waitReady()
      } else if (state === 'stopped') {
        await this.#service.startContainer()
      } else {
        await this.#service.waitReady()
      }
      await this.#verifyService(manifest)
    } else {
      await this.#restoreRecovery(recoveryVolume, previousImage, manifest)
    }
    await this.#dispose(candidate)
    await this.#service.removeVolume(recoveryVolume)
  }

  /**
   * Confirm both the stable container and volume are physically absent.
   * @throws {Error} When either resource still exists.
   */
  async #assertDetached(): Promise<void> {
    if (await this.#service.containerState() !== 'missing') {
      throw new Error('PostgreSQL source container is still present after removal')
    }
    if (await this.#service.volumeExists()) {
      throw new Error('PostgreSQL source volume is still present after removal')
    }
  }

  /**
   * Restore the preserved source volume and recreate the previous service.
   * @param recoveryVolume - Preserved source volume.
   * @param previousImage - Previous source image.
   * @param manifest - Recovery point manifest.
   */
  async #restoreRecovery(
    recoveryVolume: string,
    previousImage: string,
    manifest: BackupManifest,
  ): Promise<void> {
    await this.#service.removeContainer()
    await this.#service.removeVolume()
    await this.#service.createVolume()
    await this.#service.copyVolume(recoveryVolume, this.#service.volumeName, previousImage)
    const secret = await this.#service.secret(false)
    await this.#service.createContainer(
      this.#service.containerName,
      this.#service.volumeName,
      previousImage,
      secret.file,
    )
    await this.#service.waitReady()
    await this.#verifyService(manifest)
  }

  /**
   * Verify the live stable service against the approved backup version.
   * @param manifest - Recovery point manifest.
   */
  async #verifyService(manifest: BackupManifest): Promise<void> {
    const ownerUrl = await this.#service.ownerUrl()
    await this.#service.provisionApplicationRole(
      ownerUrl,
      manifest.artifact.appRole ?? MANAGED_APP_ROLE,
    )
    await this.#verify(ownerUrl, manifest)
  }

  /**
   * Verify schema/security readiness and canonical User/Role data.
   * @param ownerUrl - Administrative owner URL.
   * @param manifest - Recovery point manifest.
   */
  async #verify(ownerUrl: string, manifest: BackupManifest): Promise<void> {
    const sql = new BunSQL(ownerUrl)
    try {
      await sql.connect()
      const readiness = await DDL.readiness(sql, manifest.artifact)
      if (!readiness.ready) {
        throw new Error(`Restored schema is not ready: ${readiness.discrepancies.join('; ')}`)
      }
      const digest = await this.#canonicalDigest(sql)
      if (digest !== manifest.dataDigest) {
        throw new Error('Restored canonical User/Role data does not match the backup manifest')
      }
    } finally {
      await sql.close()
    }
  }

  /**
   * Read the deterministic digest of canonical User/Role/UserRole data.
   * @param sql - Administrative connection.
   * @returns SHA-256 digest.
   */
  async #canonicalDigest(sql: BunSQL): Promise<string> {
    const users = await sql<{ data: unknown }[]>`
      SELECT to_jsonb(t) AS data
      FROM "User" t
      ORDER BY t."id"
    `
    const roles = await sql<{ data: unknown }[]>`
      SELECT to_jsonb(t) AS data
      FROM "Role" t
      ORDER BY t."id"
    `
    const userRoles = await sql<{ data: unknown }[]>`
      SELECT to_jsonb(t) AS data
      FROM "UserRole" t
      ORDER BY t."user.id", t."role.id"
    `
    return DDL.hash(JSON.stringify({
      roles: roles.map(row => row.data),
      userRoles: userRoles.map(row => row.data),
      users: users.map(row => row.data),
    }))
  }

  /**
   * Read and validate a backup archive and its sidecar manifest.
   * @param path - Backup archive path.
   * @returns The validated manifest.
   */
  async #readBackup(path: string): Promise<BackupManifest> {
    const manifestPath = `${path}.json`
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) throw new Error('Backup manifest is not an object')
    const manifest = parsed as Partial<BackupManifest>
    if (manifest.version !== MANIFEST_VERSION) throw new Error('Backup manifest version is unsupported')
    if (typeof manifest.checksum !== 'string' || typeof manifest.dataDigest !== 'string') {
      throw new Error('Backup manifest is missing verification data')
    }
    if (typeof manifest.image !== 'string' || typeof manifest.createdAt !== 'string') {
      throw new Error('Backup manifest is missing provenance')
    }
    if (typeof manifest.artifact !== 'object' || manifest.artifact === null) {
      throw new Error('Backup manifest is missing its approved artifact')
    }
    const checksum = createHash('sha256').update(await readFile(path)).digest('hex')
    if (checksum !== manifest.checksum) throw new Error('Backup archive checksum does not match its manifest')
    return manifest as BackupManifest
  }

  /**
   * Run a Docker command and fail with its stderr.
   * @param args - Command and arguments.
   * @param message - Failure prefix.
   * @returns The command result.
   */
  async #docker(args: readonly string[], message: string) {
    const [command, ...rest] = args
    const result = await runAsync(command as string, rest)
    if (result.exitCode !== 0) throw new Error(`${message}: ${result.stderr.trim() || result.exitCode}`)
    return result
  }

  /**
   * Remove one disposable container and volume.
   * @param restore - Disposable restore handle.
   */
  async #dispose(restore: Pick<DisposableRestore, 'container' | 'volume'>): Promise<void> {
    await this.#service.removeContainer(restore.container)
    await this.#service.removeVolume(restore.volume)
  }

  /**
   * Write a local ignore file for backup artifacts.
   * @param directory - Backup directory.
   */
  async #protectDirectory(directory: string): Promise<void> {
    await writeFile(join(directory, '.gitignore'), '*\n', { mode: 0o644 })
  }
}
