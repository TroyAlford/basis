import { run, runAsync } from 'basis/configuration'
import { Logger } from 'basis/logger'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { EntityDefinitions } from './EntityDefinitions'
import { Server } from './Server'
import { SortDirection } from './SortDirection'

/*
 * Real PostgreSQL lifecycle. The suite owns Docker services through the
 * server capability; it never replaces the database boundary with a mock.
 */

const root = join(import.meta.dir, '..', '..', '..')
const silent = new Logger({ silent: true })

/** A container mount from `docker inspect`. */
interface InspectMount {
  /** Mount destination inside the container. */
  Destination: string,
  /** Host source path. */
  Source: string,
}

/**
 * Find the containers owned by a managed application root.
 * @param install - The application root used in the ownership label.
 * @returns The container ids.
 */
function containers(install: string): readonly string[] {
  return run`docker ps -aq --filter ${`label=basis.install=${install}`}`.lines
}

/**
 * Remove the containers and durable volume for a managed application root.
 * @param install - The application root used in the ownership label.
 */
function removeService(install: string): void {
  for (const id of containers(install)) void run`docker rm -f ${id}`
  for (const volume of run`docker volume ls -q --filter ${`label=basis.install=${install}`}`.lines) {
    void run`docker volume rm -f ${volume}`
  }
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

describe('Server database lifecycle', () => {
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
      const a = startWithInstall(new Server().root(assetsA1).database(), installA, service)
      const b = startWithInstall(new Server().root(assetsB).database(), installB, service)

      try {
        await Promise.all([a.ready(), b.ready()])
        const aId = containers(installA)[0]
        const bId = containers(installB)[0]
        if (!aId) throw new Error('installation A did not start its database')
        if (!bId) throw new Error('installation B did not start its database')
        expect(aId).not.toBe(bId)
        expect(portOf(aId)).not.toBe(portOf(bId))

        await a.db.sql`create table install_probe (value text)`
        await a.db.sql`insert into install_probe values ('A')`
        await b.db.sql`create table install_probe (value text)`
        await b.db.sql`insert into install_probe values ('B')`

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
        expect(await bAgain.db.sql<{ value: string }[]>`select value from install_probe`)
          .toEqual([{ value: 'B' }])

        // Same checkout, changed SERVICE_NAME and asset root: same database.
        const aAgain = startWithInstall(new Server().root(assetsA2).database(), installA, `${service}-next`)
        try {
          await aAgain.ready()
          expect(await aAgain.db.sql<{ value: string }[]>`select value from install_probe`)
            .toEqual([{ value: 'A' }])

          // A second process for the same installation attaches to the same service.
          const aTwin = startWithInstall(new Server().root(assetsA1).database(), installA, `${service}-twin`)
          try {
            await aTwin.ready()
            expect(containers(installA)).toHaveLength(1)
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
      removeService(installA)
      removeService(installB)
    }
  }, 180_000)

  test('exposes Bun SQL parameterization and error semantics', async () => {
    const service = `basis-e2e-sql-${randomUUID()}`
    const install = tempDirectory('basis-install-')

    try {
      const server = startWithInstall(new Server().root(install).database(), install, service)
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
      removeService(install)
    }
  }, 120_000)

  test('commits and rolls back through pooled Bun transactions', async () => {
    const service = `basis-e2e-tx-${randomUUID()}`
    const install = tempDirectory('basis-install-tx-')

    try {
      const server = startWithInstall(new Server().root(install).database(), install, service)
      try {
        await server.ready()
        await server.db.sql`create table tx_probe (value text)`

        const result = await server.db.tx(async tx => {
          await tx`insert into tx_probe values ('committed')`
          return 'callback-result'
        })
        expect(result).toBe('callback-result')

        const count = async (): Promise<number | undefined> => {
          const rows = await server.db.sql<{ count: number }[]>`
            select count(*)::int as count from tx_probe
          `
          return rows[0]?.count
        }
        expect(await count()).toBe(1)

        await expect(server.db.tx(async tx => {
          await tx`insert into tx_probe values ('thrown')`
          throw new Error('rollback')
        })).rejects.toThrow('rollback')
        expect(await count()).toBe(1)

        await expect(server.db.tx(async tx => {
          await tx`insert into tx_probe values ('failed')`
          await tx`select * from basis_missing_tx_relation`
        })).rejects.toMatchObject({ errno: '42P01' })
        expect(await count()).toBe(1)
      } finally {
        await server.shutdown()
      }
    } finally {
      removeService(install)
    }
  }, 120_000)

  test('creates physical tables from canonical entities and reruns safely', async () => {
    const service = `basis-e2e-schema-${randomUUID()}`
    const install = tempDirectory('basis-install-schema-')

    try {
      const entities = EntityDefinitions.load(JSON.stringify({
        entities: [
          {
            fields: [
              { name: 'id', primaryKey: true, type: 'uuid' },
              { name: 'title', type: 'string' },
              { name: 'active', type: 'boolean' },
              { name: 'score', type: 'number' },
              { name: 'dueOn', type: 'date' },
              { name: 'createdAt', type: 'timestamp' },
            ],
            name: 'Note',
          },
          {
            fields: [
              { name: 'id', primaryKey: true, type: 'snowflake' },
              { name: 'name', type: 'string' },
            ],
            name: 'Account',
          },
        ],
      }))
      const server = startWithInstall(new Server().root(install).database({ entities }), install, service)
      try {
        await server.ready()
        await entities.createTables(server.db.sql)

        const noteColumns = await server.db.sql<{
          columnName: string,
          dataType: string,
          isNullable: string,
          tableName: string,
        }[]>`
          select
            table_name as "tableName",
            column_name as "columnName",
            data_type as "dataType",
            is_nullable as "isNullable"
          from information_schema.columns
          where table_name = ${'Note'}
          order by ordinal_position
        `
        const accountColumns = await server.db.sql<{
          columnName: string,
          dataType: string,
          isNullable: string,
          tableName: string,
        }[]>`
          select
            table_name as "tableName",
            column_name as "columnName",
            data_type as "dataType",
            is_nullable as "isNullable"
          from information_schema.columns
          where table_name = ${'Account'}
          order by ordinal_position
        `
        expect([...noteColumns, ...accountColumns]).toEqual([
          { columnName: 'id', dataType: 'uuid', isNullable: 'NO', tableName: 'Note' },
          { columnName: 'title', dataType: 'text', isNullable: 'NO', tableName: 'Note' },
          { columnName: 'active', dataType: 'boolean', isNullable: 'NO', tableName: 'Note' },
          { columnName: 'score', dataType: 'double precision', isNullable: 'NO', tableName: 'Note' },
          { columnName: 'dueOn', dataType: 'date', isNullable: 'NO', tableName: 'Note' },
          { columnName: 'createdAt', dataType: 'timestamp with time zone', isNullable: 'NO', tableName: 'Note' },
          { columnName: 'id', dataType: 'bigint', isNullable: 'NO', tableName: 'Account' },
          { columnName: 'name', dataType: 'text', isNullable: 'NO', tableName: 'Account' },
        ])

        const primaryKeys = await server.db.sql<{ tableName: string }[]>`
          select tc.table_name as "tableName"
          from information_schema.table_constraints tc
          where tc.constraint_type = 'PRIMARY KEY'
            and tc.table_name in (${'Note'}, ${'Account'})
          order by tc.table_name
        `
        expect(primaryKeys.map(row => row.tableName)).toEqual(['Account', 'Note'])

        await server.db.sql`
          insert into "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
          values (gen_random_uuid(), 'kept', true, 1.5, '2026-01-02', now())
        `
        await server.db.sql`insert into "Account" ("id", "name") values (${'9223372036854775807'}, ${'Troy'})`
        await entities.createTables(server.db.sql)
        expect(await server.db.sql<{ count: number }[]>`select count(*)::int as count from "Note"`)
          .toEqual([{ count: 1 }])
        expect(await server.db.sql<{ id: string }[]>`select id::text as id from "Account"`)
          .toEqual([{ id: '9223372036854775807' }])
        expect(await server.db.sql<{ id: string }[]>`select id from "Account"`)
          .toEqual([{ id: '9223372036854775807' }])

        const account = await server.db.query<{ id: bigint, name: string }>('Account', {
          fields: ['id', 'name'],
          where: { id: '9223372036854775807' },
        })
        expect(account).toEqual([{ id: 9223372036854775807n, name: 'Troy' }])
        expect(typeof account[0]?.id).toBe('bigint')

        expect(await server.db.query<{ score: number, title: string }>('Note', {
          fields: ['title', 'score'],
        })).toEqual([{ score: 1.5, title: 'kept' }])
        await server.db.sql`
          insert into "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
          values (gen_random_uuid(), 'ignored', false, 2, '2026-01-03', now())
        `
        expect(await server.db.query<{ title: string }>('Note', {
          fields: ['title'],
          where: { title: 'kept' },
        })).toEqual([{ title: 'kept' }])
        expect(await server.db.query<{ title: string }>('Note', {
          fields: ['title'],
          where: { title: "kept' OR true --" },
        })).toEqual([])
        await expect(server.db.query('Note', {
          fields: ['title'],
          where: { missing: 'kept' },
        })).rejects.toThrow('Unknown field "Note.missing"')

        expect(await server.db.query<{ title: string }>('Note', {
          fields: ['title'],
          limit: 1,
          orderBy: { direction: SortDirection.Descending, field: 'score' },
        })).toEqual([{ title: 'ignored' }])
        expect(await server.db.query<{ title: string }>('Note', {
          fields: ['title'],
          limit: 1,
          offset: 1,
          orderBy: { field: 'title' },
        })).toEqual([{ title: 'kept' }])
        expect(await server.db.query<{ title: string }>('Note', {
          fields: ['title'],
          limit: 1,
          orderBy: { direction: SortDirection.Descending, field: 'score' },
          where: { active: false },
        })).toEqual([{ title: 'ignored' }])
        expect(await server.db.query<{ title: string }>('Note', {
          fields: ['title'],
          limit: 2,
          orderBy: 'title',
        })).toEqual([{ title: 'ignored' }, { title: 'kept' }])
        await server.db.sql`
          insert into "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
          values
            (gen_random_uuid(), 'beta', true, 5, '2026-01-04', now()),
            (gen_random_uuid(), 'alpha', true, 5, '2026-01-04', now())
        `
        expect(await server.db.query<{ title: string }>('Note', {
          fields: ['title'],
          orderBy: ['score', { direction: SortDirection.Ascending, field: 'title' }],
          where: { score: 5 },
        })).toEqual([{ title: 'alpha' }, { title: 'beta' }])
        await expect(server.db.query('Note', {
          fields: ['title'],
          orderBy: { field: 'missing' },
        })).rejects.toThrow('Unknown field "Note.missing"')
        await expect(server.db.query('Note', {
          fields: ['title'],
          orderBy: { direction: 'sideways' as SortDirection, field: 'title' },
        })).rejects.toThrow('Query orderBy direction must be "asc" or "desc"')
        await expect(server.db.query('Note', {
          fields: ['title'],
          limit: -1,
          orderBy: { field: 'title' },
        })).rejects.toThrow('Query limit must be a non-negative integer')

        await expect(server.db.query('Note', { fields: ['missing'] }))
          .rejects.toThrow('Unknown field "Note.missing"')
        await expect(server.db.query('Missing', { fields: ['id'] }))
          .rejects.toThrow('Unknown entity "Missing"')
        await expect(server.db.query('Note', { fields: [] }))
          .rejects.toThrow('Query fields must be a non-empty array')

        await server.db.sql`
          insert into "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
          select gen_random_uuid(), 'page-' || value, true, value, '2026-01-03', now()
          from generate_series(1, 30) as series(value)
        `
        expect(await server.db.query('Note', { fields: ['title'] })).toHaveLength(25)
        expect(await server.db.query('Note', { fields: ['title'], limit: null })).toHaveLength(34)

        await server.db.sql`create schema later`
        await server.db.sql`create table later."Shadow" (marker text)`
        const shadow = EntityDefinitions.load(JSON.stringify({
          entities: [{
            fields: [
              { name: 'id', primaryKey: true, type: 'snowflake' },
              { name: 'label', type: 'string' },
            ],
            name: 'Shadow',
          }],
        }))
        await server.db.tx(async transaction => {
          await transaction`set local search_path to public, later`
          await shadow.createTables(transaction)
        })
        expect(await server.db.sql<{ tableSchema: string }[]>`
          select table_schema as "tableSchema"
          from information_schema.tables
          where table_name = ${'Shadow'}
          order by table_schema
        `).toEqual([{ tableSchema: 'later' }, { tableSchema: 'public' }])
      } finally {
        await server.shutdown()
      }
    } finally {
      removeService(install)
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
      await expect(server.db.tx(async () => undefined)).rejects.toThrow('No database is configured for this server')
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
    const child = await runAsync(process.execPath, ['-e', script], {
      cwd: root,
      env: { PATH: '/nonexistent' },
      logger: silent,
    })

    expect(child.exitCode).toBe(0)
    expect(child.stderr).toBe('')
    const result = JSON.parse(child.lines.at(-1) ?? '{}') as { error?: string, status?: string }
    expect(result.status).toBe('error')
    expect(result.error).toContain('requires Docker')
  }, 60_000)
})
