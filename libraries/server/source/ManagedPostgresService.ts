import { runAsync } from 'basis/configuration'
import { SQL as BunSQL } from 'bun'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Resolve the stable per-installation managed database identity.
 *
 * The normalized application working/checkout directory is the only identity
 * input; service names and asset roots do not move the database.
 * @param installation - The application working/checkout directory.
 * @returns The hashed managed database identity.
 */
export function managedDatabaseIdentity(installation: string): string {
  return createHash('sha1').update(resolve(installation)).digest('hex').slice(0, 16)
}

/** The managed database's user and database name. */
export const MANAGED_DATABASE = 'basis'
/** The restricted application login role. */
export const MANAGED_APP_ROLE = 'basis_app'
/** The PostgreSQL image used by the managed local database. */
export const MANAGED_IMAGE = 'postgres:17-alpine'
/** The PostgreSQL port inside the managed container. */
const MANAGED_PORT = 5432
/** How long to wait for the managed container to accept connections. */
const READY_TIMEOUT_MS = 60_000
/** How often to poll the managed container's readiness. */
const READY_POLL_MS = 200
/** Error shown when a managed database is configured without Docker. */
const DOCKER_REQUIRED =
  'A managed database requires Docker. Install Docker and make sure the daemon is running.'
/** The container mount for the host-owned password file. */
export const PASSWORD_MOUNT = '/run/secrets/basis-postgres-password'

/** A managed container's observed state. */
export type ManagedContainerState = 'missing' | 'running' | 'stopped'

/** One resolved managed database connection. */
export interface ManagedServiceConnection {
  /** Restricted application URL, when application-role mode is enabled. */
  readonly appUrl?: string,
  /** Administrative owner URL. */
  readonly ownerUrl: string,
  /** Published loopback port. */
  readonly port: number,
}

/** Options for one managed PostgreSQL installation. */
export interface ManagedPostgresServiceOptions {
  /** Managed PostgreSQL image; defaults to `postgres:17-alpine`. */
  readonly image?: string,
}

/** Durable phase of an interrupted cutover. */
export type CutoverPhase = 'committed' | 'detached' | 'prepared'

/** Minimum durable state needed to recover an interrupted cutover. */
export interface CutoverJournal {
  /** Candidate volume retained for diagnosis. */
  readonly candidateVolume: string,
  /** Durable cutover phase. */
  readonly phase: CutoverPhase,
  /** Proven source recovery volume. */
  readonly recoveryVolume: string,
  /** Source image needed to restart the recovery volume. */
  readonly sourceImage: string,
  /** Journal schema version. */
  readonly version: 1,
}

/**
 * Extract the published localhost port from `docker port` output.
 * @param output - Output such as `127.0.0.1:49152`.
 * @returns The port, or null when no port was published.
 */
export function publishedPort(output: string): number | null {
  const match = /:(\d+)\s*$/m.exec(output.trim())
  return match ? Number(match[1]) : null
}

/**
 * The concrete lifecycle and credential owner for one managed installation.
 *
 * This is package-local infrastructure shared by the runtime database and the
 * host-run operations coordinator. It never adds a scheduler or another owner.
 */
export class ManagedPostgresService {
  /** The stable per-installation identity. */
  readonly identity: string
  /** The installation root. */
  readonly installation: string
  /** The stable managed container name. */
  readonly containerName: string
  /** The stable managed data volume name. */
  readonly volumeName: string
  /** The selected PostgreSQL image. */
  readonly image: string

  /**
   * Build the service for one installation.
   * @param installation - Application installation root.
   * @param options - Image override.
   */
  constructor(installation: string, options: ManagedPostgresServiceOptions = {}) {
    this.installation = resolve(installation)
    this.identity = managedDatabaseIdentity(this.installation)
    this.containerName = `basis-postgres-${this.identity}`
    this.volumeName = this.containerName
    this.image = options.image ?? MANAGED_IMAGE
  }

  /**
   * Reconcile the stable service and resolve its administrative connection.
   * @param authorization - Whether to provision the restricted app role.
   * @returns Owner and optional application URLs.
   */
  async ensure(authorization = false): Promise<ManagedServiceConnection> {
    if (!Bun.which('docker')) throw new Error(DOCKER_REQUIRED)
    await this.#reconcileCutover()
    const state = await this.containerState()
    const hasVolume = await this.volumeExists()
    const secret = await this.secret(state === 'missing' && !hasVolume)
    if (!hasVolume) await this.createVolume(this.volumeName)
    if (state === 'missing') {
      await this.createContainer(this.containerName, this.volumeName, this.image, secret.file)
      await this.waitReady()
    } else if (state === 'stopped') {
      await this.startContainer(this.containerName)
    }
    const port = await this.publishedPort(this.containerName)
    const ownerUrl = this.databaseUrl(MANAGED_DATABASE, secret.password, port)
    if (!authorization) return { ownerUrl, port }
    const appUrl = await this.provisionApplicationRole(ownerUrl)
    return { appUrl, ownerUrl, port }
  }

  /**
   * Resolve the owner URL for an already running stable service.
   * @returns The administrative URL.
   */
  async ownerUrl(): Promise<string> {
    const secret = await this.secret(false)
    const port = await this.publishedPort(this.containerName)
    return this.databaseUrl(MANAGED_DATABASE, secret.password, port)
  }

  /**
   * Read or create the restricted application password file.
   * @returns The application password.
   */
  async applicationSecret(): Promise<string> {
    return this.roleSecret('app-password')
  }

  /**
   * Create or update the restricted application login role.
   * @param ownerUrl - Administrative owner connection.
   * @param appRole - Application role name.
   * @param port - Published loopback port; defaults to the stable service.
   * @returns The restricted application URL.
   */
  async provisionApplicationRole(
    ownerUrl: string,
    appRole = MANAGED_APP_ROLE,
    port?: number,
  ): Promise<string> {
    const password = await this.applicationSecret()
    const admin = new BunSQL(ownerUrl)
    try {
      await admin.connect()
      const quoted = password.replaceAll("'", "''")
      await admin.unsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appRole}') THEN
            CREATE ROLE "${appRole}" LOGIN PASSWORD '${quoted}'
              NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
          ELSE
            ALTER ROLE "${appRole}" WITH LOGIN PASSWORD '${quoted}'
              NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
          END IF;
        END $$;
      `).simple()
      await admin.unsafe(`GRANT CONNECT ON DATABASE "${MANAGED_DATABASE}" TO "${appRole}"`).simple()
    } finally {
      await admin.close()
    }
    const published = port ?? await this.publishedPort(this.containerName)
    return `postgres://${appRole}:${encodeURIComponent(password)}@127.0.0.1:${published}/${MANAGED_DATABASE}`
  }

  /**
   * Build a managed PostgreSQL URL.
   * @param role - Login role.
   * @param password - Login password.
   * @param port - Published loopback port.
   * @returns The URL.
   */
  databaseUrl(role: string, password: string, port: number): string {
    return `postgres://${role}:${encodeURIComponent(password)}@127.0.0.1:${port}/${MANAGED_DATABASE}`
  }

  /**
   * Read or create one managed role password.
   * @param name - Password filename inside the managed database state directory.
   * @returns The role password.
   */
  async roleSecret(name: string): Promise<string> {
    return (await this.secret(false, name)).password
  }

  /**
   * Resolve the persistent password file, creating it only for a new service.
   * @param create - Whether a missing owner password may be initialized.
   * @param name - Password filename.
   * @returns The password and its host file path.
   */
  async secret(
    create: boolean,
    name = 'password',
  ): Promise<{ file: string, password: string }> {
    const stateRoot = join(this.installation, '.basis')
    const directory = join(stateRoot, 'database')
    await mkdir(stateRoot, { mode: 0o700, recursive: true })
    await chmod(stateRoot, 0o700)
    await mkdir(directory, { mode: 0o700, recursive: true })
    await chmod(directory, 0o700)
    await this.#protectState(directory)
    const file = join(directory, name)
    if (create || name !== 'password') {
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
    }
    let password: string
    try {
      password = (await readFile(file, 'utf8')).trim()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `Managed database credentials are missing for "${this.identity}"; ` +
          'restore the password file or deprovision the database explicitly.',
          { cause: error },
        )
      }
      throw error
    }
    if (!password) throw new Error(`Managed ${name} credentials are empty`)
    await chmod(file, 0o600)
    return { file, password }
  }

  /**
   * Persist the prepared cutover identity before any source detachment.
   * @param journal - Cutover state.
   */
  async beginCutover(journal: Omit<CutoverJournal, 'phase' | 'version'>): Promise<void> {
    await this.#writeCutover({ ...journal, phase: 'prepared', version: 1 })
  }

  /**
   * Advance the durable cutover phase.
   * @param phase - New phase.
   */
  async markCutover(phase: CutoverPhase): Promise<void> {
    const journal = await this.#readCutover()
    if (!journal) throw new Error('Database cutover journal is missing')
    await this.#writeCutover({ ...journal, phase })
  }

  /**
   * Remove the cutover journal after a committed or recovered outcome.
   */
  async clearCutover(): Promise<void> {
    await rm(this.#cutoverPath(), { force: true })
  }

  /**
   * Recover a cutover interrupted by process death before normal provisioning.
   * @throws {Error} When the recovery volume or journal is missing or malformed.
   */
  async #reconcileCutover(): Promise<void> {
    const journal = await this.#readCutover()
    if (!journal) return
    if (journal.phase === 'committed') {
      if (!await this.volumeExists()) {
        throw new Error(
          'Database cutover was committed but the stable volume is missing; refusing to provision an empty replacement',
        )
      }
      await this.clearCutover()
      return
    }
    const hasSource = await this.volumeExists()
    if (journal.phase === 'prepared' && hasSource) {
      const state = await this.containerState()
      if (state === 'missing') {
        const secret = await this.secret(false)
        await this.createContainer(
          this.containerName,
          this.volumeName,
          journal.sourceImage,
          secret.file,
        )
        await this.waitReady()
      }
      await this.clearCutover()
      return
    }
    if (!await this.volumeExists(journal.recoveryVolume)) {
      throw new Error(
        `Interrupted database cutover recovery volume "${journal.recoveryVolume}" is missing; ` +
        'refusing to provision an empty replacement',
      )
    }
    await this.removeContainer()
    await this.removeVolume()
    await this.createVolume()
    await this.copyVolume(journal.recoveryVolume, this.volumeName, journal.sourceImage)
    const secret = await this.secret(false)
    await this.createContainer(
      this.containerName,
      this.volumeName,
      journal.sourceImage,
      secret.file,
    )
    await this.waitReady()
    await this.clearCutover()
  }

  /**
   * Read the durable cutover journal.
   * @returns The journal, or null when absent.
   */
  async #readCutover(): Promise<CutoverJournal | null> {
    let raw: string
    try {
      raw = await readFile(this.#cutoverPath(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (error) {
      throw new Error('Database cutover journal is malformed; refusing to provision', { cause: error })
    }
    if (typeof value !== 'object' || value === null) {
      throw new Error('Database cutover journal is malformed; refusing to provision')
    }
    const journal = value as Partial<CutoverJournal>
    if (
      journal.version !== 1
      || !['committed', 'detached', 'prepared'].includes(journal.phase ?? '')
      || typeof journal.candidateVolume !== 'string'
      || typeof journal.recoveryVolume !== 'string'
      || typeof journal.sourceImage !== 'string'
    ) {
      throw new Error('Database cutover journal is incomplete; refusing to provision')
    }
    return journal as CutoverJournal
  }

  /**
   * Atomically persist the durable cutover journal.
   * @param journal - Journal contents.
   */
  async #writeCutover(journal: CutoverJournal): Promise<void> {
    const file = this.#cutoverPath()
    const temporary = `${file}.${randomUUID()}`
    await mkdir(join(this.installation, '.basis', 'database'), { mode: 0o700, recursive: true })
    await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, file)
  }

  /**
   * Resolve the durable cutover journal path.
   * @returns Absolute path.
   */
  #cutoverPath(): string {
    return join(this.installation, '.basis', 'database', 'cutover.json')
  }

  /**
   * Ensure Git never stages the installation's database state.
   * @param directory - The installation-local `.basis/database` directory.
   */
  async #protectState(directory: string): Promise<void> {
    const ignore = join(directory, '.gitignore')
    try {
      const handle = await open(ignore, 'wx', 0o644)
      try {
        await handle.writeFile('*\n')
      } finally {
        await handle.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  /**
   * Observe a managed container without mutating it.
   * @param name - Container name.
   * @returns Its running state, or `missing`.
   */
  async containerState(name = this.containerName): Promise<ManagedContainerState> {
    const result = await runAsync`
      docker ps -a
      --filter ${`name=^/${name}$`}
      --format {{.State}}
    `
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || `docker ps exited with ${result.exitCode}`
      throw new Error(`PostgreSQL service discovery failed: ${detail}`)
    }
    if (result.lines.length === 0) return 'missing'
    return result.lines[0] === 'running' ? 'running' : 'stopped'
  }

  /**
   * Whether a Docker volume exists.
   * @param name - Volume name.
   * @returns `true` when Docker knows the volume.
   */
  async volumeExists(name = this.volumeName): Promise<boolean> {
    const result = await runAsync`docker volume ls -q --filter ${`name=^${name}$`}`
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || `docker volume ls exited with ${result.exitCode}`
      throw new Error(`PostgreSQL volume discovery failed: ${detail}`)
    }
    return result.lines.length > 0
  }

  /**
   * Create a Docker volume with application ownership labels.
   * @param name - Volume name.
   * @param extraLabels - Additional labels.
   */
  async createVolume(name = this.volumeName, extraLabels: readonly string[] = []): Promise<void> {
    const labels = [
      '--label', `basis.database=${this.identity}`,
      '--label', `basis.install=${this.installation}`,
      ...extraLabels,
    ]
    const created = await runAsync('docker', ['volume', 'create', ...labels, name])
    if (created.exitCode !== 0) {
      const detail = created.stderr.trim() || `docker volume create exited with ${created.exitCode}`
      throw new Error(`PostgreSQL data volume failed to start: ${detail}`)
    }
  }

  /**
   * Create one managed PostgreSQL container.
   * @param name - Container name.
   * @param volume - Data volume name.
   * @param image - PostgreSQL image.
   * @param passwordFile - Host owner-password file.
   */
  async createContainer(
    name: string,
    volume: string,
    image: string,
    passwordFile: string,
  ): Promise<void> {
    const run = await runAsync('docker', [
      'run', '-d', '--pull', 'missing',
      '--name', name,
      '--label', `basis.database=${this.identity}`,
      '--label', `basis.install=${this.installation}`,
      '-e', `POSTGRES_USER=${MANAGED_DATABASE}`,
      '-e', `POSTGRES_PASSWORD_FILE=${PASSWORD_MOUNT}`,
      '-e', `POSTGRES_DB=${MANAGED_DATABASE}`,
      '-v', `${volume}:/var/lib/postgresql/data`,
      '-v', `${passwordFile}:${PASSWORD_MOUNT}:ro`,
      '-p', `127.0.0.1::${MANAGED_PORT}`,
      image,
    ])
    if (run.exitCode === 0) return
    const state = await this.containerState(name)
    if (state === 'missing') {
      const detail = run.stderr.trim() || `docker run exited with ${run.exitCode}`
      throw new Error(`PostgreSQL service failed to start: ${detail}`)
    }
    if (state === 'stopped') await this.startContainer(name)
  }

  /**
   * Start one stopped container and wait for PostgreSQL readiness.
   * @param name - Container name.
   */
  async startContainer(name = this.containerName): Promise<void> {
    const started = await runAsync`docker start ${name}`
    if (started.exitCode !== 0) {
      const detail = started.stderr.trim() || `docker start exited with ${started.exitCode}`
      throw new Error(`PostgreSQL service failed to start: ${detail}`)
    }
    await this.waitReady(name)
  }

  /**
   * Stop one running container.
   * @param name - Container name.
   */
  async stopContainer(name = this.containerName): Promise<void> {
    const result = await runAsync`docker stop ${name}`
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || `docker stop exited with ${result.exitCode}`
      throw new Error(`PostgreSQL service failed to stop: ${detail}`)
    }
  }

  /**
   * Remove one container, treating only verified absence as success.
   * @param name - Container name.
   * @throws {Error} When Docker fails and the container still exists.
   */
  async removeContainer(name = this.containerName): Promise<void> {
    if (await this.containerState(name) === 'missing') return
    const result = await runAsync`docker rm -f ${name}`
    if (await this.containerState(name) === 'missing') return
    const detail = result.stderr.trim() || `docker rm exited with ${result.exitCode}`
    throw new Error(`PostgreSQL container removal failed: ${detail}`)
  }

  /**
   * Remove one volume, treating only verified absence as success.
   * @param name - Volume name.
   * @throws {Error} When Docker fails and the volume still exists.
   */
  async removeVolume(name = this.volumeName): Promise<void> {
    if (!await this.volumeExists(name)) return
    const result = await runAsync`docker volume rm -f ${name}`
    if (!await this.volumeExists(name)) return
    const detail = result.stderr.trim() || `docker volume rm exited with ${result.exitCode}`
    throw new Error(`PostgreSQL volume removal failed: ${detail}`)
  }

  /**
   * Discover a container's Docker-allocated loopback port.
   * @param name - Container name.
   * @returns The published host port.
   */
  async publishedPort(name = this.containerName): Promise<number> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await runAsync`docker port ${name} ${`${MANAGED_PORT}/tcp`}`
      const port = publishedPort(result.stdout)
      if (port !== null) return port
      await Bun.sleep(READY_POLL_MS)
    }
    throw new Error('PostgreSQL service did not publish a loopback port')
  }

  /**
   * Wait for one container to accept connections through its final server.
   * @param name - Container name.
   */
  async waitReady(name = this.containerName): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    const args = [
      'exec', name, 'pg_isready', '-h', '127.0.0.1',
      '-U', MANAGED_DATABASE, '-d', MANAGED_DATABASE,
    ]
    while (Date.now() < deadline) {
      const result = await runAsync('docker', args)
      if (result.exitCode === 0) {
        // The image's temporary initdb server has no TCP listener; confirm the final server stayed up.
        await Bun.sleep(1_000)
        const confirmed = await runAsync('docker', args)
        if (confirmed.exitCode === 0) return
      }
      await Bun.sleep(READY_POLL_MS)
    }
    const logs = await runAsync`docker logs ${name}`
    throw new Error(
      `PostgreSQL did not accept connections within ${READY_TIMEOUT_MS}ms:\n${logs.stdout}${logs.stderr}`,
    )
  }

  /**
   * Read the image currently running one container.
   * @param name - Container name.
   * @returns Image reference.
   */
  async containerImage(name = this.containerName): Promise<string> {
    const result = await runAsync`docker inspect --format {{.Config.Image}} ${name}`
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || `docker inspect exited with ${result.exitCode}`
      throw new Error(`PostgreSQL image inspection failed: ${detail}`)
    }
    return result.stdout.trim()
  }

  /**
   * Copy one Docker volume into another through a PostgreSQL image shell.
   * @param from - Source volume.
   * @param to - Target volume.
   * @param image - Image providing the copy shell.
   */
  async copyVolume(from: string, to: string, image: string): Promise<void> {
    const result = await runAsync('docker', [
      'run', '--rm', '--entrypoint', 'sh',
      '-v', `${from}:/from:ro`,
      '-v', `${to}:/to`,
      image,
      '-c',
      'rm -rf /to/* /to/.[!.]* 2>/dev/null || true; cp -a /from/. /to/',
    ])
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || `volume copy exited with ${result.exitCode}`
      throw new Error(`PostgreSQL volume copy failed: ${detail}`)
    }
  }
}
