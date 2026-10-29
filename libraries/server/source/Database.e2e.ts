import { Logger } from 'basis/logger'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Server } from './Server'

/*
 * Real PostgreSQL lifecycle. The suite owns Docker services through the
 * server capability; it never replaces the database boundary with a mock.
 */

const root = join(import.meta.dir, '..', '..', '..')

/** Docker command result. */
interface DockerResult {
  /** Process exit code. */
  code: number,
  /** Standard error. */
  stderr: string,
  /** Standard output. */
  stdout: string,
}

/** A container mount from `docker inspect`. */
interface InspectMount {
  /** Mount destination inside the container. */
  Destination: string,
  /** Host source path. */
  Source: string,
}

/**
 * Run a Docker CLI command and capture its output.
 * @param args - Arguments after `docker`.
 * @returns The exit code and captured output.
 */
function docker(args: string[]): DockerResult {
  const child = Bun.spawnSync(['docker', ...args], { stderr: 'pipe', stdout: 'pipe' })
  const decoder = new TextDecoder()
  return {
    code: child.exitCode ?? -1,
    stderr: decoder.decode(child.stderr),
    stdout: decoder.decode(child.stdout),
  }
}

/**
 * Find the containers owned by a managed database identity.
 * @param identity - The identity used in the ownership label.
 * @returns The container ids.
 */
function containers(identity: string): string[] {
  return docker(['ps', '-aq', '--filter', `label=basis.database=${identity}`])
    .stdout.trim().split('\n').filter(Boolean)
}

/**
 * Remove the containers and durable volume for a managed database identity.
 * @param identity - The identity used in the ownership label.
 */
function removeService(identity: string): void {
  for (const id of containers(identity)) docker(['rm', '-f', id])
  const volumes = docker(['volume', 'ls', '-q', '--filter', `label=basis.database=${identity}`])
    .stdout.trim().split('\n').filter(Boolean)
  for (const volume of volumes) docker(['volume', 'rm', '-f', volume])
}

/**
 * Read the published loopback port for a container.
 * @param id - The container id.
 * @returns The host port.
 */
function portOf(id: string): number {
  const match = /:(\d+)\s*$/m.exec(docker(['port', id, '5432/tcp']).stdout.trim())
  if (!match) throw new Error(`container ${id} did not publish a port`)
  return Number(match[1])
}

/**
 * Start a server with a temporary SERVICE_NAME, which fixes its managed identity.
 * @param server - The configured server.
 * @param service - The service name for this installation.
 * @returns The started server.
 */
function startWithService(server: Server, service: string): Server {
  const previous = process.env.SERVICE_NAME
  process.env.SERVICE_NAME = service
  try {
    return start(server)
  } finally {
    if (previous === undefined) delete process.env.SERVICE_NAME
    else process.env.SERVICE_NAME = previous
  }
}

/**
 * Build a server with a silent logger.
 * @param server - The configured server.
 * @returns The started server.
 */
function start(server: Server): Server {
  return server.start({ development: true, hostname: '127.0.0.1', logger: new Logger({ silent: true }), port: 0 })
}

/**
 * Read the current health payload.
 * @param server - The started server.
 * @returns The health status and optional error.
 */
async function health(server: Server): Promise<{ error?: string, status?: string }> {
  const response = await server.handle(new Request('http://localhost/api/health'))
  if (!response) throw new Error('health route did not respond')
  return await response.json() as { error?: string, status?: string }
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
}

/**
 * Inspect a container's password mount and metadata.
 * @param id - The container id.
 * @returns The raw inspect output, password, and file mode.
 */
async function credentials(id: string): Promise<CredentialInspection> {
  const raw = docker(['inspect', id]).stdout
  const inspect = JSON.parse(raw) as { Mounts: InspectMount[] }[]
  const mount = inspect[0]?.Mounts.find(entry => entry.Destination === '/run/secrets/basis-postgres-password')
  if (!mount) throw new Error('container has no password-file mount')
  const password = (await readFile(mount.Source, 'utf8')).trim()
  const mode = (await stat(mount.Source)).mode & 0o777
  const directoryMode = (await stat(dirname(mount.Source))).mode & 0o777
  return { directoryMode, mode, password, raw }
}

describe('Server database lifecycle', () => {
  test('supports independent installs, durable restart, and same-install reconnection', async () => {
    const dataHome = tempDirectory('basis-db-data-')
    const previousData = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = dataHome
    const serviceA = `basis-e2e-a-${randomUUID()}`
    const serviceB = `basis-e2e-b-${randomUUID()}`
    const rootA = tempDirectory('basis-install-a-')
    const rootB = tempDirectory('basis-install-b-')

    try {
      const a = startWithService(new Server().root(rootA).database(), serviceA)
      const b = startWithService(new Server().root(rootB).database(), serviceB)

      try {
        await Promise.all([a.ready(), b.ready()])
        const aId = containers(serviceA)[0]
        const bId = containers(serviceB)[0]
        if (!aId) throw new Error('installation A did not start its database')
        if (!bId) throw new Error('installation B did not start its database')
        expect(aId).not.toBe(bId)
        expect(portOf(aId)).not.toBe(portOf(bId))

        await a.db.sql`create table install_probe (value text)`
        await a.db.sql`insert into install_probe values ('A')`
        await b.db.sql`create table install_probe (value text)`
        await b.db.sql`insert into install_probe values ('B')`

        const secret = await credentials(aId)
        expect(secret.directoryMode).toBe(0o700)
        expect(secret.mode).toBe(0o600)
        expect(secret.raw).not.toContain(secret.password)
        expect(secret.raw).not.toContain('"POSTGRES_PASSWORD=')
        expect(secret.raw).not.toContain('basis.password')
        const volume = docker(['volume', 'ls', '-q', '--filter', `label=basis.database=${serviceA}`]).stdout.trim()
        expect(volume).not.toBe('')
        expect(docker(['volume', 'inspect', volume]).stdout).not.toContain(secret.password)
      } finally {
        await a.shutdown()
        await b.shutdown()
      }

      // Closing pools does not stop or deprovision either application service.
      expect(containers(serviceA)).toHaveLength(1)
      expect(containers(serviceB)).toHaveLength(1)

      const bAgain = startWithService(new Server().root(rootB).database(), serviceB)
      try {
        await bAgain.ready()
        expect(await bAgain.db.sql<{ value: string }[]>`select value from install_probe`)
          .toEqual([{ value: 'B' }])

        const aAgain = startWithService(new Server().root(rootA).database(), serviceA)
        try {
          await aAgain.ready()
          expect(await aAgain.db.sql<{ value: string }[]>`select value from install_probe`)
            .toEqual([{ value: 'A' }])

          // A second process for the same installation attaches to the same service.
          const aTwin = startWithService(new Server().root(rootA).database(), serviceA)
          try {
            await aTwin.ready()
            expect(containers(serviceA)).toHaveLength(1)
            expect(await aTwin.db.sql<{ value: string }[]>`select value from install_probe`)
              .toEqual([{ value: 'A' }])
          } finally {
            await aTwin.shutdown()
          }
        } finally {
          await aAgain.shutdown()
        }

        // The other installation stayed available through A's restart.
        expect(await bAgain.db.sql<{ value: string }[]>`select value from install_probe`)
          .toEqual([{ value: 'B' }])
      } finally {
        await bAgain.shutdown()
      }
    } finally {
      if (previousData === undefined) delete process.env.XDG_DATA_HOME
      else process.env.XDG_DATA_HOME = previousData
      removeService(serviceA)
      removeService(serviceB)
    }
  }, 180_000)

  test('exposes Bun SQL parameterization and error semantics', async () => {
    const dataHome = tempDirectory('basis-db-data-')
    const previousData = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = dataHome
    const service = `basis-e2e-sql-${randomUUID()}`
    const install = tempDirectory('basis-install-')

    try {
      const server = startWithService(new Server().root(install).database(), service)
      try {
        await server.ready()
        const injected = "Robert'); drop table users; --"
        const rows = await server.db.sql<{ text: string, value: number }[]>`
          select ${injected} as text, ${7} as value
        `
        expect(rows[0]?.text).toBe(injected)
        expect(rows[0]?.value).toBe(7)

        const failure = await server.db.sql`select * from basis_missing_relation`
          .catch((error: unknown) => error)
        expect(failure).toMatchObject({ errno: '42P01' })
      } finally {
        await server.shutdown()
      }
    } finally {
      if (previousData === undefined) delete process.env.XDG_DATA_HOME
      else process.env.XDG_DATA_HOME = previousData
      removeService(service)
    }
  }, 120_000)

  test('reports unhealthy when an external PostgreSQL connection fails', async () => {
    const server = start(new Server().database({
      url: 'postgres://basis:basis@127.0.0.1:1/basis',
    }))

    try {
      await expect(server.ready()).rejects.toThrow()
      const result = await health(server)
      expect(result.status).toBe('error')
      expect(result.error).toBeDefined()
    } finally {
      await server.shutdown()
    }
  }, 30_000)

  test('uses a null capability when no database is configured', async () => {
    const server = start(new Server())

    try {
      await expect(server.db.connect()).rejects.toThrow('No database is configured for this server')
      expect(() => server.db.sql).toThrow('No database is configured for this server')
    } finally {
      await server.shutdown()
    }

    expect(server.db.closed).toBe(true)
  }, 30_000)

  test('reports unhealthy when a managed database needs Docker but Docker is unavailable', async () => {
    const script = `
      import { Logger } from 'basis/logger'
      import { Server } from 'basis/server'

      const server = new Server().database().start({
        development: true,
        hostname: '127.0.0.1',
        logger: new Logger({ silent: true }),
        port: 0,
      })
      const deadline = Date.now() + 15_000
      let body = null
      while (Date.now() < deadline) {
        const response = await Bun.fetch(\`http://127.0.0.1:\${server.port}/api/health\`)
        body = await response.json()
        if (body.status === 'error') break
        await Bun.sleep(50)
      }
      console.log(JSON.stringify(body))
      await server.shutdown()
    `
    const child = Bun.spawn([process.execPath, '-e', script], {
      cwd: root,
      env: { ...process.env, PATH: '/nonexistent' },
      stderr: 'pipe',
      stdout: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    expect(code).toBe(0)
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as { error?: string, status?: string }
    expect(result.status).toBe('error')
    expect(result.error).toContain('requires Docker')
  }, 60_000)
})
