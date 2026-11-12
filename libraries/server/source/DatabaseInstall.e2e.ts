import { run } from 'basis/configuration'
import { Logger } from 'basis/logger'
import { tempDirectory } from 'basis/testing'
import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { containers, noteDefinition, removeService } from '../testing/DatabaseFixture'
import { installSchema } from '../testing/Schema'
import { EntityDefinitions } from './EntityDefinitions'
import { Server } from './Server'

/*
 * Destructive installation lifecycle proof. This test deliberately owns,
 * restarts and removes PostgreSQL services, so it runs only in the operational
 * recovery lane and never in the ordinary shared-database suite.
 */

const silent = new Logger({ silent: true })

/** A container mount from `docker inspect`. */
interface InspectMount {
  /** Mount destination inside the container. */
  Destination: string,
  /** Host source path. */
  Source: string,
}

/**
 * Read the published loopback port for a container.
 * @param id - The container id.
 * @returns The host port.
 */
function portOf(id: string): number {
  const match = /:(\d+)\s*$/m.exec(run`docker port ${id} 5432/tcp`.stdout.trim())
  if (!match) throw new Error(`container ${id} did not publish a port`)
  return Number(match[1])
}

/**
 * Start a server from a specific installation directory.
 * @param server - The configured server.
 * @param install - The installation working/checkout directory.
 * @param service - Optional SERVICE_NAME to prove it does not affect identity.
 * @returns The started server.
 */
function startWithInstall(server: Server, install: string, service?: string): Server {
  const previousCwd = process.cwd()
  const previousService = Bun.env.SERVICE_NAME
  process.chdir(install)
  if (service === undefined) delete Bun.env.SERVICE_NAME
  else Bun.env.SERVICE_NAME = service
  try {
    return start(server)
  } finally {
    process.chdir(previousCwd)
    if (previousService === undefined) delete Bun.env.SERVICE_NAME
    else Bun.env.SERVICE_NAME = previousService
  }
}

/**
 * Build a server with a silent logger.
 * @param server - The configured server.
 * @returns The started server.
 */
function start(server: Server): Server {
  return server.start({ development: true, hostname: '127.0.0.1', logger: silent, port: 0 })
}

/** Inspected credential material and its access controls. */
interface CredentialInspection {
  /** Password directory mode. */
  directoryMode: number,
  /** Password file mode. */
  mode: number,
  /** The password value, for leak checks only. */
  password: string,
  /** Raw container inspect output. */
  raw: string,
  /** Host path of the password file. */
  source: string,
}

/**
 * Inspect a container's password mount and metadata.
 * @param id - The container id.
 * @returns The raw inspect output, password, and file mode.
 */
async function credentials(id: string): Promise<CredentialInspection> {
  const raw = run`docker inspect ${id}`.stdout
  const inspect = JSON.parse(raw) as { Mounts: InspectMount[] }[]
  const mount = inspect[0]?.Mounts.find(entry => entry.Destination === '/run/secrets/basis-postgres-password')
  if (!mount) throw new Error('container has no password-file mount')
  const password = (await readFile(mount.Source, 'utf8')).trim()
  const mode = (await stat(mount.Source)).mode & 0o777
  const directoryMode = (await stat(dirname(mount.Source))).mode & 0o777
  return { directoryMode, mode, password, raw, source: mount.Source }
}

test('supports independent installs, durable restart, and same-install reconnection', async () => {
  const service = `basis-e2e-${randomUUID()}`
  const installA = tempDirectory('basis-checkout-a-')
  const installB = tempDirectory('basis-checkout-b-')
  const assetsA1 = tempDirectory('basis-assets-a1-')
  const assetsA2 = tempDirectory('basis-assets-a2-')
  const assetsB = tempDirectory('basis-assets-b-')
  run('git', ['init', '-q'], { cwd: installA, logger: silent })

  try {
    // Same SERVICE_NAME, distinct checkout cwd: each installation remains independent.
    const aEntities = EntityDefinitions.load(JSON.stringify({ entities: [noteDefinition] }))
    const a = startWithInstall(
      new Server().root(assetsA1).database(),
      installA,
      service,
    )
    const b = startWithInstall(new Server().root(assetsB).database(), installB, service)

    try {
      await Promise.all([a.ready(), b.ready()])
      const aId = containers(installA)[0]
      const bId = containers(installB)[0]
      if (!aId) throw new Error('installation A did not start its database')
      if (!bId) throw new Error('installation B did not start its database')
      expect(aId).not.toBe(bId)
      expect(portOf(aId)).not.toBe(portOf(bId))

      expect(await a.db.sql<{ present: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm' ) AS present
      `).toEqual([{ present: false }])
      await installSchema(a.db.sql, aEntities, { schema: 'public' })
      expect(await a.db.sql<{ present: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm' ) AS present
      `).toEqual([{ present: true }])

      await a.db.sql`
        CREATE TABLE install_probe (value text)
      `
      await a.db.sql`
        INSERT INTO install_probe
        VALUES ('A')
      `
      await b.db.sql`
        CREATE TABLE install_probe (value text)
      `
      await b.db.sql`
        INSERT INTO install_probe
        VALUES ('B')
      `

      const secret = await credentials(aId)
      expect(secret.source.startsWith(join(installA, '.basis', 'database'))).toBe(true)
      expect(secret.directoryMode).toBe(0o700)
      expect(secret.mode).toBe(0o600)
      run('git', ['add', '.'], { cwd: installA, logger: silent })
      expect(run('git', ['status', '--porcelain'], { cwd: installA, logger: silent }).stdout).toBe('')
      expect(secret.raw).not.toContain(secret.password)
      expect(secret.raw).not.toContain('"POSTGRES_PASSWORD=')
      expect(secret.raw).not.toContain('basis.password')
      const volume = run`docker volume ls -q --filter ${`label=basis.install=${installA}`}`.lines[0]
      expect(volume).toBeTruthy()
      expect(run`docker volume inspect ${volume}`.stdout).not.toContain(secret.password)
    } finally {
      await a.shutdown()
      await b.shutdown()
    }

    // Closing pools does not stop or deprovision either application service.
    expect(containers(installA)).toHaveLength(1)
    expect(containers(installB)).toHaveLength(1)

    const bAgain = startWithInstall(new Server().root(assetsB).database(), installB, `${service}-b`)
    try {
      await bAgain.ready()
      expect(await bAgain.db.sql<{ value: string }[]>`
        SELECT value
        FROM install_probe
      `)
        .toEqual([{ value: 'B' }])

      // Same checkout, changed SERVICE_NAME and asset root: same database.
      const aAgain = startWithInstall(new Server().root(assetsA2).database(), installA, `${service}-next`)
      try {
        await aAgain.ready()
        expect(await aAgain.db.sql<{ value: string }[]>`
          SELECT value
          FROM install_probe
        `)
          .toEqual([{ value: 'A' }])

        // A second process for the same installation attaches to the same service.
        const aTwin = startWithInstall(new Server().root(assetsA1).database(), installA, `${service}-twin`)
        try {
          await aTwin.ready()
          expect(containers(installA)).toHaveLength(1)
          expect(await aTwin.db.sql<{ value: string }[]>`
            SELECT value
            FROM install_probe
          `)
            .toEqual([{ value: 'A' }])
        } finally {
          await aTwin.shutdown()
        }
      } finally {
        await aAgain.shutdown()
      }

      // The other installation stayed available through A's restart.
      expect(await bAgain.db.sql<{ value: string }[]>`
        SELECT value
        FROM install_probe
      `)
        .toEqual([{ value: 'B' }])
    } finally {
      await bAgain.shutdown()
    }
  } finally {
    const removed = [removeService(installA), removeService(installB)]
    expect(removed).toEqual([true, true])
  }
}, 180_000)
