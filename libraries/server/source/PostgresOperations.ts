import { runAsync } from 'basis/configuration'
import { SQL as BunSQL } from 'bun'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { managedDatabaseIdentity } from './Database'

/** Managed PostgreSQL owner/database name. */
const DATABASE = 'basis'
/** Managed PostgreSQL backup role. */
const BACKUP_ROLE = 'basis_backup'
/** Managed PostgreSQL application role. */
const APP_ROLE = 'basis_app'
/** Container mount for the owner password file. */
const PASSWORD_MOUNT = '/run/secrets/basis-postgres-password'
/** Managed PostgreSQL internal port. */
const PORT = 5432
/** Readiness polling interval. */
const POLL_MS = 250
/** Readiness timeout. */
const READY_MS = 60_000

/** Options for managed operations. */
export interface PostgresOperationsOptions {
  /** Optional backup directory; defaults to `.basis/backups` below installation. */
  readonly backupDirectory?: string,
  /** Installation root; defaults to the current working directory. */
  readonly installation?: string,
}

/** One completed database backup. */
export interface PostgresBackup {
  /** SHA-256 archive digest. */
  readonly checksum: string,
  /** Backup creation timestamp. */
  readonly createdAt: string,
  /** Source image recorded in the manifest. */
  readonly image: string,
  /** Sidecar manifest path. */
  readonly manifest: string,
  /** Backup archive path. */
  readonly path: string,
}

/** Restore inputs. */
export interface PostgresRestoreOptions {
  /** Target image; defaults to the source container image. */
  readonly image?: string,
  /** Application data readback executed against the restored database. */
  readonly verify?: (sql: BunSQL) => Promise<void>,
}

/** Restore verification result. */
export interface PostgresRestoreResult {
  /** Image used for the disposable restore. */
  readonly image: string,
  /** Whether the verified restore completed. */
  readonly verified: true,
}

/** Upgrade result. */
export interface PostgresUpgradeResult {
  /** Recovery point taken before cutover. */
  readonly backup: PostgresBackup,
  /** Target image now running. */
  readonly image: string,
  /** Previous source image. */
  readonly previousImage: string,
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
 * This class never schedules itself and never starts a daemon. Callers invoke
 * backup, restore, upgrade, or rollback from their host scheduler or operator
 * shell. The managed service and its data volumes remain the source of truth.
 */
export class ManagedPostgresOperations {
  readonly #backupDirectory: string
  readonly #container: string
  readonly #identity: string
  readonly #installation: string
  readonly #volume: string

  /**
   * Build operations for one managed installation.
   * @param options - Installation and backup directory overrides.
   */
  constructor(options: PostgresOperationsOptions = {}) {
    this.#installation = resolve(options.installation ?? process.cwd())
    this.#identity = managedDatabaseIdentity(this.#installation)
    this.#container = `basis-postgres-${this.#identity}`
    this.#volume = this.#container
    this.#backupDirectory = resolve(
      options.backupDirectory ?? join(this.#installation, '.basis', 'backups'),
    )
  }

  /**
   * Create a verified custom-format backup through the read-only backup role.
   * @returns The backup artifact metadata.
   */
  async backup(): Promise<PostgresBackup> {
    await this.#ensureSourceRunning()
    const createdAt = new Date().toISOString()
    const stem = `${createdAt.replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`
    const path = join(this.#backupDirectory, `${stem}.dump`)
    const manifest = `${path}.json`
    await mkdir(this.#backupDirectory, { mode: 0o700, recursive: true })
    await chmod(this.#backupDirectory, 0o700)
    await this.#protectDirectory(this.#backupDirectory)
    const remote = `/tmp/basis-backup-${randomUUID()}.dump`
    try {
      await this.#dockerExec(
        ['docker', 'exec', this.#container, 'pg_dump', '-U', BACKUP_ROLE, '-d', DATABASE, '--format=custom',
          '--file', remote],
        'pg_dump failed',
      )
      await this.#docker(['docker', 'cp', `${this.#container}:${remote}`, path], 'docker cp failed')
      await chmod(path, 0o600)
      await this.#dockerExec(
        ['docker', 'exec', this.#container, 'rm', '-f', remote],
        'backup cleanup failed',
      )
      const checksum = createHash('sha256').update(await readFile(path)).digest('hex')
      const image = await this.#containerImage()
      const result = { checksum, createdAt, image, manifest, path }
      await writeFile(manifest, `${JSON.stringify({ ...result, version: 1 }, null, 2)}\n`, { mode: 0o600 })
      return result
    } catch (error) {
      await rm(path, { force: true })
      await rm(manifest, { force: true })
      throw error
    }
  }

  /**
   * Restore into disposable storage and verify application data readback.
   * @param backup - Backup archive path.
   * @param options - Target image and readback callback.
   * @returns Verification result after disposal.
   */
  async restore(
    backup: string,
    options: PostgresRestoreOptions = {},
  ): Promise<PostgresRestoreResult> {
    const image = options.image ?? await this.#containerImage()
    const restore = await this.#prepareRestore(backup, image, options.verify)
    try {
      return { image, verified: true }
    } finally {
      await this.#dispose(restore)
    }
  }

  /**
   * Upgrade managed PostgreSQL through a verified logical recovery point.
   *
   * The caller must stop application pools before invoking this method. The
   * source container is replaced with the target image only after a disposable
   * restore has passed verification. A failed cutover restores the recovery
   * point and the previous image before rethrowing.
   * @param targetImage - Target PostgreSQL image.
   * @param options - Application data readback callback.
   * @returns Recovery point and new image.
   */
  async upgrade(
    targetImage: string,
    options: PostgresRestoreOptions = {},
  ): Promise<PostgresUpgradeResult> {
    const previousImage = await this.#containerImage()
    const recovery = await this.backup()
    const target = await this.#prepareRestore(recovery.path, targetImage, options.verify)
    try {
      await this.#cutover(target, targetImage, options.verify)
      return { backup: recovery, image: targetImage, previousImage }
    } catch (error) {
      await this.#dispose(target)
      await this.rollback(recovery.path, previousImage, options.verify)
      throw error
    }
  }

  /**
   * Restore one recovery point into the managed source volume.
   * The caller must stop application pools before invoking this method.
   * @param backup - Backup archive path.
   * @param image - Image for the restored source container; defaults to current.
   * @param verify - Optional application data readback.
   */
  async rollback(
    backup: string,
    image?: string,
    verify?: (sql: BunSQL) => Promise<void>,
  ): Promise<void> {
    const targetImage = image ?? await this.#containerImage()
    const restore = await this.#prepareRestore(backup, targetImage, verify)
    try {
      await this.#cutover(restore, targetImage, verify)
    } finally {
      await this.#dispose(restore)
    }
  }

  /**
   * Ensure the managed source service is running for an online backup.
   */
  async #ensureSourceRunning(): Promise<void> {
    const state = await this.#containerState()
    if (state === 'missing') throw new Error(`Managed PostgreSQL service "${this.#container}" is missing`)
    if (state === 'running') return
    await this.#docker(['docker', 'start', this.#container], 'managed database failed to start')
    await this.#waitReady(this.#container)
  }

  /**
   * Create and verify disposable storage from one backup.
   * @param backup - Backup archive.
   * @param image - Target image.
   * @param verify - Application readback.
   * @returns The disposable restore handle.
   */
  async #prepareRestore(
    backup: string,
    image: string,
    verify?: (sql: BunSQL) => Promise<void>,
  ): Promise<DisposableRestore> {
    const restore = {
      container: `basis-restore-${randomUUID()}`,
      volume: `basis-restore-volume-${randomUUID()}`,
    }
    const passwordFile = join(this.#installation, '.basis', 'database', 'password')
    const password = await this.#password('password')
    try {
      await this.#docker(['docker', 'volume', 'create', restore.volume], 'restore volume creation failed')
      await this.#docker([
        'docker', 'run', '-d', '--pull', 'missing', '--name', restore.container,
        '-e', `POSTGRES_USER=${DATABASE}`, '-e', `POSTGRES_PASSWORD_FILE=${PASSWORD_MOUNT}`,
        '-e', `POSTGRES_DB=${DATABASE}`, '-v', `${restore.volume}:/var/lib/postgresql/data`,
        '-v', `${passwordFile}:${PASSWORD_MOUNT}:ro`, '-p', `127.0.0.1::${PORT}`, image,
      ], 'restore container failed to start')
      await this.#waitReady(restore.container)
      await this.#docker(['docker', 'cp', backup, `${restore.container}:/tmp/basis-restore.dump`], 'backup copy failed')
      await this.#dockerExec([
        'docker', 'exec', restore.container, 'pg_restore', '-U', DATABASE, '-d', DATABASE,
        '--clean', '--if-exists', '/tmp/basis-restore.dump',
      ], 'pg_restore failed')
      if (verify) await this.#verify(restore.container, verify, password)
      return restore
    } catch (error) {
      await this.#dispose(restore)
      throw error
    }
  }

  /**
   * Replace the managed source volume and container from a verified restore.
   * @param restore - Verified disposable restore.
   * @param image - Target image.
   * @param verify - Application readback after cutover.
   */
  async #cutover(
    restore: DisposableRestore,
    image: string,
    verify?: (sql: BunSQL) => Promise<void>,
  ): Promise<void> {
    await this.#docker(['docker', 'stop', restore.container], 'restore container failed to stop')
    await this.#docker(['docker', 'rm', '-f', restore.container], 'restore container failed to remove')
    await this.#docker(['docker', 'rm', '-f', this.#container], 'source container failed to remove')
    await this.#docker(['docker', 'volume', 'rm', '-f', this.#volume], 'source volume failed to remove')
    await this.#docker([
      'docker', 'volume', 'create', '--label', `basis.database=${this.#identity}`,
      '--label', `basis.install=${this.#installation}`, this.#volume,
    ], 'source volume creation failed')
    try {
      await this.#copyVolume(restore.volume, this.#volume, image)
      await this.#createSourceContainer(image)
      await this.#waitReady(this.#container)
      await this.#provisionRoles()
      if (verify) await this.#verify(this.#container, verify, await this.#password('password'))
      await this.#docker(['docker', 'volume', 'rm', '-f', restore.volume], 'restore volume cleanup failed')
    } catch (error) {
      await this.#docker(['docker', 'rm', '-f', this.#container], 'failed source container cleanup failed')
      await this.#docker(['docker', 'volume', 'rm', '-f', this.#volume], 'failed source volume cleanup failed')
      throw error
    }
  }

  /**
   * Copy one Docker volume into another through the target image.
   * @param from - Source volume.
   * @param to - Target volume.
   * @param image - Image providing the copy shell.
   */
  async #copyVolume(from: string, to: string, image: string): Promise<void> {
    await this.#docker([
      'docker', 'run', '--rm', '--entrypoint', 'sh', '-v', `${from}:/from:ro`,
      '-v', `${to}:/to`, image, '-c',
      'rm -rf /to/* /to/.[!.]* 2>/dev/null || true; cp -a /from/. /to/',
    ], 'volume copy failed')
  }

  /**
   * Create the stable managed container with the owner password mount.
   * @param image - Target PostgreSQL image.
   */
  async #createSourceContainer(image: string): Promise<void> {
    const password = join(this.#installation, '.basis', 'database', 'password')
    await this.#docker([
      'docker', 'run', '-d', '--pull', 'missing', '--name', this.#container,
      '--label', `basis.database=${this.#identity}`, '--label', `basis.install=${this.#installation}`,
      '-e', `POSTGRES_USER=${DATABASE}`, '-e', `POSTGRES_PASSWORD_FILE=${PASSWORD_MOUNT}`,
      '-e', `POSTGRES_DB=${DATABASE}`, '-v', `${this.#volume}:/var/lib/postgresql/data`,
      '-v', `${password}:${PASSWORD_MOUNT}:ro`, '-p', `127.0.0.1::${PORT}`, image,
    ], 'managed database failed to start')
  }

  /**
   * Provision the runtime and backup roles after a restore.
   */
  async #provisionRoles(): Promise<void> {
    const port = await this.#port()
    const owner = await this.#password('password')
    const app = await this.#rolePassword('app-password')
    const backup = await this.#rolePassword('backup-password')
    const url = `postgres://${DATABASE}:${encodeURIComponent(owner)}@127.0.0.1:${port}/${DATABASE}`
    const sql = new BunSQL({ connectionTimeout: 10, idleTimeout: 30, max: 1, url })
    try {
      await sql.connect()
      await this.#ensureRole(sql, APP_ROLE, app, false)
      await this.#ensureRole(sql, BACKUP_ROLE, backup, true)
    } finally {
      await sql.close()
    }
  }

  /**
   * Create or update one managed login role.
   * @param sql - Owner connection.
   * @param role - Role name.
   * @param password - Role password.
   * @param backup - Whether to grant read-only backup capabilities.
   */
  async #ensureRole(sql: BunSQL, role: string, password: string, backup: boolean): Promise<void> {
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE "${role}" LOGIN PASSWORD '${password.replaceAll("'", "''")}'
            NOSUPERUSER NOCREATEDB NOCREATEROLE ${backup ? 'INHERIT' : 'NOINHERIT'} NOBYPASSRLS;
        ELSE
          ALTER ROLE "${role}" WITH LOGIN PASSWORD '${password.replaceAll("'", "''")}'
            NOSUPERUSER NOCREATEDB NOCREATEROLE ${backup ? 'INHERIT' : 'NOINHERIT'} NOBYPASSRLS;
        END IF;
      END $$;
    `).simple()
    await sql.unsafe(`GRANT CONNECT ON DATABASE "${DATABASE}" TO "${role}"`).simple()
    if (backup) await sql.unsafe(`GRANT pg_read_all_data TO "${role}"`).simple()
  }

  /**
   * Execute application readback against one disposable or source container.
   * @param container - Running container.
   * @param verify - Readback callback.
   * @param password - Optional owner password for a password-authenticated container.
   */
  async #verify(
    container: string,
    verify: (sql: BunSQL) => Promise<void>,
    password?: string,
  ): Promise<void> {
    const port = await this.#port(container)
    const credentials = password === undefined
      ? `${DATABASE}@`
      : `${DATABASE}:${encodeURIComponent(password)}@`
    const url = `postgres://${credentials}127.0.0.1:${port}/${DATABASE}`
    const sql = new BunSQL({ connectionTimeout: 10, idleTimeout: 30, max: 1, url })
    try {
      await sql.connect()
      await verify(sql)
    } finally {
      await sql.close()
    }
  }

  /**
   * Wait for one container to accept database connections.
   * @param container - Container name.
   */
  async #waitReady(container: string): Promise<void> {
    const deadline = Date.now() + READY_MS
    while (Date.now() < deadline) {
      const result = await runAsync`docker exec ${container} pg_isready -U ${DATABASE} -d ${DATABASE}`
      if (result.exitCode === 0) {
        /*
         * The postgres image briefly starts a temporary server during initdb.
         * Confirm the final server is still accepting connections.
         */
        await Bun.sleep(1_000)
        const confirmed = await runAsync`docker exec ${container} pg_isready -U ${DATABASE} -d ${DATABASE}`
        if (confirmed.exitCode === 0) return
      }
      await Bun.sleep(POLL_MS)
    }
    throw new Error(`PostgreSQL container "${container}" did not become ready`)
  }

  /**
   * Discover a running container's loopback port.
   * @param container - Container name.
   * @returns The published host port.
   */
  async #port(container = this.#container): Promise<number> {
    const result = await runAsync`docker port ${container} ${`${PORT}/tcp`}`
    const match = /:(\d+)\s*$/mu.exec(result.stdout.trim())
    if (!match) throw new Error(`PostgreSQL container "${container}" has no loopback port`)
    return Number(match[1])
  }

  /**
   * Read one managed password file.
   * @param name - Password filename.
   * @returns The password.
   */
  async #password(name: string): Promise<string> {
    const file = join(this.#installation, '.basis', 'database', name)
    const password = (await readFile(file, 'utf8')).trim()
    if (!password) throw new Error(`Managed ${name} is empty`)
    return password
  }

  /**
   * Read or create one managed role password.
   * @param name - Password filename.
   * @returns The role password.
   */
  async #rolePassword(name: string): Promise<string> {
    const directory = join(this.#installation, '.basis', 'database')
    const file = join(directory, name)
    try {
      const handle = await open(file, 'wx', 0o600)
      try {
        await handle.writeFile(randomUUID())
      } finally {
        await handle.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const password = (await readFile(file, 'utf8')).trim()
    if (!password) throw new Error(`Managed ${name} is empty`)
    await chmod(file, 0o600)
    return password
  }

  /**
   * Read the source container image.
   * @returns Image reference.
   */
  async #containerImage(): Promise<string> {
    const result = await this.#docker([
      'docker', 'inspect', '--format', '{{.Config.Image}}', this.#container,
    ], 'managed database image inspection failed')
    return result.stdout.trim()
  }

  /**
   * Observe the managed container.
   * @returns Running, stopped, or missing.
   */
  async #containerState(): Promise<'missing' | 'running' | 'stopped'> {
    const result = await runAsync`
      docker ps -a --filter ${`name=^/${this.#container}$`} --format {{.State}}
    `
    if (result.exitCode !== 0) throw new Error(`PostgreSQL service discovery failed: ${result.stderr.trim()}`)
    if (result.lines.length === 0) return 'missing'
    return result.lines[0] === 'running' ? 'running' : 'stopped'
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
   * Alias for Docker exec commands.
   * @param args - Command and arguments.
   * @param message - Failure prefix.
   * @returns The command result.
   */
  async #dockerExec(args: readonly string[], message: string) {
    return this.#docker(args, message)
  }

  /**
   * Remove one disposable container and volume.
   * @param restore - Disposable restore handle.
   */
  async #dispose(restore: DisposableRestore): Promise<void> {
    await runAsync`docker rm -f ${restore.container}`
    await runAsync`docker volume rm -f ${restore.volume}`
  }

  /**
   * Write a local ignore file for backup artifacts.
   * @param directory - Backup directory.
   */
  async #protectDirectory(directory: string): Promise<void> {
    await writeFile(join(directory, '.gitignore'), '*\n', { mode: 0o644 })
  }
}
