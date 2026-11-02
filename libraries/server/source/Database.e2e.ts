import { run, runAsync } from 'basis/configuration'
import { Logger } from 'basis/logger'
import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { accountDefinition, containers, noteDefinition, numberRowDefinition, removeService, useDatabaseFixture } from '../testing/DatabaseFixture'
import type { DurableDatabase, IsolatedDatabase } from '../testing/DatabaseIsolation'
import { withDurableDatabase, withIsolatedDatabase } from '../testing/DatabaseIsolation'
import { toMatchSQL } from '../testing/toMatchSQL'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'
import type { Filter } from './Predicate'
import { Server } from './Server'
import { SortDirection } from './SortDirection'

/*
 * Real PostgreSQL lifecycle. The suite owns Docker services through the
 * server capability; it never replaces the database boundary with a mock.
 */

expect.extend({ toMatchSQL })

/** The universal identity root DDL included in every complete schema. */
const identityDdl = [
  'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public',
  `CREATE TABLE "Entity" (
    "id" TEXT PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    CONSTRAINT "Entity_id_format_check" CHECK (
      CASE
        WHEN "id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN TRUE
        WHEN "id" ~ '^(0|-?[1-9][0-9]*)$' AND length("id") <= 20
          THEN "id"::numeric BETWEEN -9223372036854775808 AND 9223372036854775807
        ELSE FALSE
      END
    )
  )`,
  `CREATE INDEX IF NOT EXISTS "Entity_displayName_id_idx"
    ON "Entity" ("displayName" ASC, "id" ASC)`,
  `CREATE INDEX IF NOT EXISTS "Entity_displayName_trgm_idx"
    ON "Entity" USING GIN ("displayName" public.gin_trgm_ops)`,
]

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

/**
 * Register an ordinary transaction-isolated database test.
 * @param name - Test name and fixture label.
 * @param callback - Test work.
 * @param timeout - Test timeout in milliseconds.
 */
function isolatedTest(
  name: string,
  callback: (database: IsolatedDatabase) => Promise<void>,
  timeout = 120_000,
): void {
  test(name, () => withIsolatedDatabase(name, callback), timeout)
}

/**
 * Register a cross-transaction database test in a durable unique schema.
 * @param name - Test name and fixture label.
 * @param callback - Test work.
 * @param timeout - Test timeout in milliseconds.
 */
function durableTest(
  name: string,
  callback: (database: DurableDatabase) => Promise<void>,
  timeout = 120_000,
): void {
  test(name, () => withDurableDatabase(name, callback), timeout)
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
      const removed = [removeService(installA), removeService(installB)]
      expect(removed).toEqual([true, true])
    }
  }, 180_000)

  isolatedTest('exposes Bun SQL parameterization and error semantics', async database => {
    const injected = "Robert'); drop table users; --"
    const rows = await database.sql<{ text: string, value: number }[]>`
      select ${injected} as text, ${7} as value
    `
    expect(rows[0]?.text).toBe(injected)
    expect(rows[0]?.value).toBe(7)

    const failure = await database.captureError(async db => {
      await db.sql`select * from basis_missing_relation`
    })
    expect(failure).toMatchObject({ errno: '42P01' })
  })

  durableTest('commits and rolls back through pooled Bun transactions', async database => {
    await database.tx(async tx => {
      await tx`create table tx_probe (value text)`
    })

    const result = await database.tx(async tx => {
      await tx`insert into tx_probe values ('committed')`
      return 'callback-result'
    })
    expect(result).toBe('callback-result')

    const count = async (): Promise<number | undefined> => (
      await database.tx(async tx => {
        const rows = await tx<{ count: number }[]>`
          select count(*)::int as count from tx_probe
        `
        return rows[0]?.count
      })
    )
    expect(await count()).toBe(1)

    await expect(database.tx(async tx => {
      await tx`insert into tx_probe values ('thrown')`
      throw new Error('rollback')
    })).rejects.toThrow('rollback')
    expect(await count()).toBe(1)

    await expect(database.tx(async tx => {
      await tx`insert into tx_probe values ('failed')`
      await tx`select * from basis_missing_tx_relation`
    })).rejects.toMatchObject({ errno: '42P01' })
    expect(await count()).toBe(1)
  })

  isolatedTest('creates physical tables from canonical entities and reruns safely', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [noteDefinition, accountDefinition],
    }))
    await entities.createTables(database.sql)

    const noteColumns = await database.sql<{
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
    const accountColumns = await database.sql<{
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

    const primaryKeys = await database.sql<{ tableName: string }[]>`
          select tc.table_name as "tableName"
          from information_schema.table_constraints tc
          where tc.constraint_type = 'PRIMARY KEY'
            and tc.table_name in (${'Note'}, ${'Account'})
          order by tc.table_name
        `
    expect(primaryKeys.map(row => row.tableName)).toEqual(['Account', 'Note'])

    await database.sql`
          insert into "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
          values (gen_random_uuid(), 'kept', true, 1.5, '2026-01-02', now())
        `
    await database.sql`insert into "Account" ("id", "name") values (${'9223372036854775807'}, ${'Troy'})`
    await entities.createTables(database.sql)
    expect(await database.sql<{ count: number }[]>`select count(*)::int as count from "Note"`)
      .toEqual([{ count: 1 }])
    expect(await database.sql<{ id: string }[]>`select id::text as id from "Account"`)
      .toEqual([{ id: '9223372036854775807' }])
    expect(await database.sql<{ id: string }[]>`select id from "Account"`)
      .toEqual([{ id: '9223372036854775807' }])

    const account = await database.query<{ id: bigint, name: string }>('Account', {
      fields: ['id', 'name'],
      where: { id: '9223372036854775807' },
    })
    expect(account).toEqual([{ id: 9223372036854775807n, name: 'Troy' }])
    expect(typeof account[0]?.id).toBe('bigint')

    expect(await database.query<{ score: number, title: string }>('Note', {
      fields: ['title', 'score'],
    })).toEqual([{ score: 1.5, title: 'kept' }])
    await database.sql`
          insert into "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
          values (gen_random_uuid(), 'ignored', false, 2, '2026-01-03', now())
        `
    expect(await database.query<{ title: string }>('Note', {
      fields: ['title'],
      where: { title: 'kept' },
    })).toEqual([{ title: 'kept' }])
    expect(await database.query<{ title: string }>('Note', {
      fields: ['title'],
      where: { title: "kept' OR true --" },
    })).toEqual([])
    await expect(database.query('Note', {
      fields: ['title'],
      where: { missing: 'kept' },
    })).rejects.toThrow('Unknown field "Note.missing"')

    expect(await database.query<{ title: string }>('Note', {
      fields: ['title'],
      limit: 1,
      orderBy: { direction: SortDirection.Descending, field: 'score' },
    })).toEqual([{ title: 'ignored' }])
    expect(await database.query<{ title: string }>('Note', {
      fields: ['title'],
      limit: 1,
      offset: 1,
      orderBy: { field: 'title' },
    })).toEqual([{ title: 'kept' }])
    expect(await database.query<{ title: string }>('Note', {
      fields: ['title'],
      limit: 1,
      orderBy: { direction: SortDirection.Descending, field: 'score' },
      where: { active: false },
    })).toEqual([{ title: 'ignored' }])
    expect(await database.query<{ title: string }>('Note', {
      fields: ['title'],
      limit: 2,
      orderBy: 'title',
    })).toEqual([{ title: 'ignored' }, { title: 'kept' }])
    await database.sql`
          insert into "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
          values
            (gen_random_uuid(), 'beta', true, 5, '2026-01-04', now()),
            (gen_random_uuid(), 'alpha', true, 5, '2026-01-04', now())
        `
    expect(await database.query<{ title: string }>('Note', {
      fields: ['title'],
      orderBy: ['score', { direction: SortDirection.Ascending, field: 'title' }],
      where: { score: 5 },
    })).toEqual([{ title: 'alpha' }, { title: 'beta' }])

    await expect(database.query('Note', {
      fields: ['title'],
      orderBy: { field: 'missing' },
    })).rejects.toThrow('Unknown field "Note.missing"')
    await expect(database.query('Note', {
      fields: ['title'],
      orderBy: { direction: 'sideways' as SortDirection, field: 'title' },
    })).rejects.toThrow('Query orderBy direction must be "asc" or "desc"')
    await expect(database.query('Note', {
      fields: ['title'],
      limit: -1,
      orderBy: { field: 'title' },
    })).rejects.toThrow('Query limit must be a non-negative integer')

    await expect(database.query('Note', { fields: ['missing'] }))
      .rejects.toThrow('Unknown field "Note.missing"')
    await expect(database.query('Missing', { fields: ['id'] }))
      .rejects.toThrow('Unknown entity "Missing"')
    await expect(database.query('Note', { fields: [] }))
      .rejects.toThrow('Query fields must be a non-empty array')

    await database.sql`
          insert into "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
          select gen_random_uuid(), 'page-' || value, true, value, '2026-01-03', now()
          from generate_series(1, 30) as series(value)
        `
    expect(await database.query('Note', { fields: ['title'] })).toHaveLength(25)
    expect(await database.query('Note', { fields: ['title'], limit: null })).toHaveLength(34)

    await database.sql`create schema later`
    await database.sql`create table later."Shadow" (marker text)`
    const shadow = EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'snowflake' },
          { name: 'label', type: 'string' },
        ],
        name: 'Shadow',
      }],
    }))
    await database.sql.unsafe('set local search_path to public, later').simple()
    await shadow.createTables(database.sql)
    expect(await database.sql<{ tableSchema: string }[]>`
          select table_schema as "tableSchema"
          from information_schema.tables
          where table_name = ${'Shadow'}
          order by table_schema
        `).toEqual([{ tableSchema: 'later' }, { tableSchema: 'public' }])
  }, 120_000)

  isolatedTest('creates and indexes the universal identity root', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({ entities: [noteDefinition] }))
    await entities.createTables(database.sql)

    expect(await database.sql<{ columnName: string, dataType: string, isNullable: string }[]>`
      select
        column_name as "columnName",
        data_type as "dataType",
        is_nullable as "isNullable"
      from information_schema.columns
      where table_schema = current_schema() and table_name = 'Entity'
      order by ordinal_position
    `).toEqual([
      { columnName: 'id', dataType: 'text', isNullable: 'NO' },
      { columnName: 'displayName', dataType: 'text', isNullable: 'NO' },
      { columnName: 'entity', dataType: 'text', isNullable: 'NO' },
    ])

    expect(await database.sql<{ indexName: string }[]>`
      select indexname as "indexName"
      from pg_indexes
      where schemaname = current_schema()
        and tablename = 'Entity'
        and indexname like 'Entity_displayName%'
      order by indexname
    `).toEqual([
      { indexName: 'Entity_displayName_id_idx' },
      { indexName: 'Entity_displayName_trgm_idx' },
    ])
    expect(await database.sql<{ present: boolean }[]>`
      select exists (
        select 1 from pg_extension where extname = 'pg_trgm'
      ) as present
    `).toEqual([{ present: true }])

    await database.sql`
      insert into "Entity" ("id", "displayName", "entity")
      values
        ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'UUID entity', 'Note'),
        ('0', 'Zero snowflake', 'Note'),
        ('-9223372036854775808', 'Minimum snowflake', 'Note'),
        ('9223372036854775807', 'Maximum snowflake', 'Note')
    `
    const duplicate = await database.captureError(async db => {
      await db.sql`
        insert into "Entity" ("id", "displayName", "entity")
        values ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Duplicate', 'Note')
      `
    })
    expect(duplicate).toMatchObject({ errno: '23505' })

    for (const id of [
      'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
      '01',
      '-0',
      '9223372036854775808',
      '-9223372036854775809',
      'not-an-identity',
    ]) {
      const invalid = await database.captureError(async db => {
        await db.sql`
          insert into "Entity" ("id", "displayName", "entity")
          values (${id}, 'Invalid', 'Note')
        `
      })
      expect(invalid).toMatchObject({ errno: '23514' })
    }

    await database.sql`
      insert into "Entity" ("id", "displayName", "entity")
      select
        value::text,
        'item-' || lpad(value::text, 6, '0') || '-' || md5(value::text),
        case when value % 2 = 0 then 'Note' else 'Book' end
      from generate_series(1, 100_000) as series(value)
    `
    await database.sql`analyze "Entity"`

    const sortedPlan = await database.sql<Record<string, string>[]>`
      explain (format text)
      select "id"
      from "Entity"
      where "displayName" >= 'item-050000-' and "displayName" < 'item-060000-'
      order by "displayName" asc, "id" asc
      limit 20
    `
    expect(sortedPlan.map(row => Object.values(row).join('\n')).join('\n'))
      .toContain('Entity_displayName_id_idx')

    const trigramPlan = await database.sql<Record<string, string>[]>`
      explain (format text)
      select "id"
      from "Entity"
      where "displayName" ilike '%item-042000-%'
      limit 20
    `
    expect(trigramPlan.map(row => Object.values(row).join('\n')).join('\n'))
      .toContain('Entity_displayName_trgm_idx')
  }, 120_000)

  isolatedTest('filters numeric values with each comparison operator', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [numberRowDefinition],
    }))
    await entities.createTables(database.sql)
    await database.sql`
      insert into "NumberRow" ("id", "value")
      select gen_random_uuid(), value
      from generate_series(1, 10) as series(value)
    `

    const query = (where: Filter | Readonly<Record<string, unknown>>) => (
      database.query<{ value: number }>('NumberRow', {
        fields: ['value'],
        limit: null,
        orderBy: { field: 'value' },
        where,
      })
    )

    expect(await query({ field: 'value', operator: Operator.Comparison.Equal, value: 3 })).toEqual([{ value: 3 }])
    expect(await query({ field: 'value', operator: Operator.Comparison.LessThan, value: 3 }))
      .toEqual([{ value: 1 }, { value: 2 }])
    expect(await query({ field: 'value', operator: Operator.Comparison.LessThanOrEqual, value: 3 }))
      .toEqual([{ value: 1 }, { value: 2 }, { value: 3 }])
    expect(await query({ field: 'value', operator: Operator.Comparison.GreaterThan, value: 8 }))
      .toEqual([{ value: 9 }, { value: 10 }])
    expect(await query({ field: 'value', operator: Operator.Comparison.GreaterThanOrEqual, value: 8 }))
      .toEqual([{ value: 8 }, { value: 9 }, { value: 10 }])
    expect(await query({
      filters: [
        { field: 'value', operator: Operator.Comparison.GreaterThanOrEqual, value: 3 },
        { field: 'value', operator: Operator.Comparison.LessThanOrEqual, value: 6 },
      ],
      operator: Operator.Logical.And,
    })).toEqual([{ value: 3 }, { value: 4 }, { value: 5 }, { value: 6 }])
  }, 120_000)

  isolatedTest('creates and enforces many-to-one foreign keys', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'userId', name: 'author', target: 'User', type: 'entity' },
            { name: 'title', type: 'string' },
          ],
          name: 'Post',
        },
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'snowflake' },
            { name: 'name', type: 'string' },
          ],
          name: 'User',
        },
      ],
    }))

    await entities.createTables(database.sql)

    expect(entities.ddl).toMatchSQL([
      ...identityDdl,
      `CREATE TABLE "Post" (
        "id" UUID PRIMARY KEY,
        "userId" BIGINT NOT NULL,
        "title" TEXT NOT NULL
      )`,
      `CREATE TABLE "User" (
        "id" BIGINT PRIMARY KEY,
        "name" TEXT NOT NULL
      )`,
      `ALTER TABLE "Post" ADD CONSTRAINT "Post_author_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        DEFERRABLE INITIALLY IMMEDIATE`,
    ])
    const constraints = await database.sql<{ definition: string }[]>`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = '"Post"'::regclass and contype = 'f'
    `
    expect(constraints).toEqual([{
      definition: 'FOREIGN KEY ("userId") REFERENCES "User"(id) DEFERRABLE',
    }])

    await database.sql`
      insert into "User" ("id", "name") values (${'9223372036854775807'}, ${'Ada'})
    `
    await database.sql`
      insert into "Post" ("id", "userId", "title")
      values (gen_random_uuid(), ${'9223372036854775807'}, ${'Hello'})
    `
    expect(await database.sql<{ userId: string }[]>`
      select "userId"::text as "userId" from "Post"
    `).toEqual([{ userId: '9223372036854775807' }])

    const invalidInsert = await database.captureError(async db => {
      await db.sql`
        insert into "Post" ("id", "userId", "title")
        values (gen_random_uuid(), ${'1'}, ${'Invalid'})
      `
    })
    expect(invalidInsert).toMatchObject({ errno: '23503' })

    const blockedDelete = await database.captureError(async db => {
      await db.sql`
        delete from "User" where "id" = ${'9223372036854775807'}
      `
    })
    expect(blockedDelete).toMatchObject({ errno: '23503' })
    expect(await database.sql<{ count: number }[]>`
      select count(*)::int as count from "Post"
    `).toEqual([{ count: 1 }])
  }, 120_000)

  durableTest('creates cyclic foreign keys and validates deferred references', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'carId', name: 'car', target: 'CycleCar', type: 'entity' },
          ],
          name: 'CycleUser',
        },
        {
          fields: [
            { name: 'id', primaryKey: true, type: 'uuid' },
            { column: 'userId', name: 'user', target: 'CycleUser', type: 'entity' },
          ],
          name: 'CycleCar',
        },
      ],
    }))

    await database.tx(async tx => entities.createTables(tx))

    const constraints = await database.tx(async tx => tx<{
      deferrable: boolean,
      deferred: boolean,
      definition: string,
      name: string,
    }[]>`
      select
        conname as name,
        condeferrable as deferrable,
        condeferred as deferred,
        pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid in ('"CycleUser"'::regclass, '"CycleCar"'::regclass)
        and contype = 'f'
      order by conname
    `)
    expect(constraints.map(constraint => ({
      deferrable: constraint.deferrable,
      deferred: constraint.deferred,
      name: constraint.name,
    }))).toEqual([
      { deferrable: true, deferred: false, name: 'CycleCar_user_fkey' },
      { deferrable: true, deferred: false, name: 'CycleUser_car_fkey' },
    ])
    expect(constraints.every(constraint => constraint.definition.endsWith('DEFERRABLE')))
      .toBe(true)

    const userId = randomUUID()
    const carId = randomUUID()
    await database.tx(async transaction => {
      await transaction`set constraints all deferred`
      await transaction`
        insert into "CycleUser" ("id", "carId") values (${userId}, ${carId})
      `
      await transaction`
        insert into "CycleCar" ("id", "userId") values (${carId}, ${userId})
      `
    })
    expect(await database.tx(async tx => tx<{ count: number }[]>`
      select count(*)::int as count from "CycleUser"
    `)).toEqual([{ count: 1 }])

    const invalid = await database.tx(async transaction => {
      await transaction`set constraints all deferred`
      await transaction`
        insert into "CycleCar" ("id", "userId") values (${randomUUID()}, ${randomUUID()})
      `
    }).catch((error: unknown) => error)
    expect(invalid).toMatchObject({ errno: '23503' })

    await database.tx(async tx => entities.createTables(tx))
    expect(await database.tx(async tx => tx<{ count: number }[]>`
      select count(*)::int as count
      from pg_constraint
      where conrelid in ('"CycleUser"'::regclass, '"CycleCar"'::regclass)
        and contype = 'f'
    `)).toEqual([{ count: 2 }])

    await database.tx(async tx => tx`
      alter table "CycleUser" drop constraint "CycleUser_car_fkey"
    `)
    await database.tx(async tx => tx`
      alter table "CycleUser" add constraint "CycleUser_car_fkey"
      foreign key ("carId") references "CycleCar" ("id")
    `)
    await expect(database.tx(async tx => entities.createTables(tx)))
      .rejects.toThrow('does not match the canonical model')

    await database.tx(async tx => tx`
      alter table "CycleUser" drop constraint "CycleUser_car_fkey"
    `)
    await database.tx(async tx => tx`
      alter table "CycleUser" add constraint "CycleUser_car_fkey"
      foreign key ("carId") references "CycleCar" ("id")
      on delete cascade deferrable initially immediate
    `)
    await expect(database.tx(async tx => entities.createTables(tx)))
      .rejects.toThrow('does not match the canonical model')

    await database.tx(async tx => tx`
      alter table "CycleUser" drop constraint "CycleUser_car_fkey"
    `)
    await database.tx(async tx => tx`
      alter table "CycleUser" add constraint "CycleUser_car_fkey"
      foreign key ("carId") references "CycleCar" ("id")
      deferrable initially immediate not valid
    `)
    await expect(database.tx(async tx => entities.createTables(tx)))
      .rejects.toThrow('does not match the canonical model')

    await database.tx(async tx => tx`
      alter table "CycleUser" drop constraint "CycleUser_car_fkey"
    `)
    await database.tx(async tx => entities.createTables(tx))
    expect(await database.tx(async tx => tx<{ count: number }[]>`
      select count(*)::int as count
      from pg_constraint
      where conrelid = '"CycleUser"'::regclass and conname = 'CycleUser_car_fkey'
    `)).toEqual([{ count: 1 }])
  }, 120_000)

  durableTest('enforces self-referential foreign keys', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [
          { name: 'id', primaryKey: true, type: 'uuid' },
          { column: 'parentId', name: 'parent', target: 'TreeNode', type: 'entity' },
        ],
        name: 'TreeNode',
      }],
    }))

    await database.tx(async tx => entities.createTables(tx))

    const nodeId = randomUUID()
    await database.tx(async transaction => {
      await transaction`set constraints all deferred`
      await transaction`
        insert into "TreeNode" ("id", "parentId") values (${nodeId}, ${nodeId})
      `
    })
    expect(await database.tx(async tx => tx<{ count: number }[]>`
      select count(*)::int as count from "TreeNode"
    `)).toEqual([{ count: 1 }])

    const invalid = await database.tx(async transaction => {
      await transaction`set constraints all deferred`
      await transaction`
        insert into "TreeNode" ("id", "parentId") values (${randomUUID()}, ${randomUUID()})
      `
    }).catch((error: unknown) => error)
    expect(invalid).toMatchObject({ errno: '23503' })
  }, 120_000)

  isolatedTest('rejects physical reference columns and unfinished graph operations', async database => {

    await expect(database.query('Article', { fields: ['ownerId'] }))
      .rejects.toThrow('Unknown field "Article.ownerId"')
    await expect(database.query('Article', { fields: ['owner'] }))
      .rejects.toThrow('entity reference; graph projections are not supported yet')

    await expect(database.query('Article', {
      fields: ['id'],
      where: { ownerId: '1' },
    })).rejects.toThrow('Unknown field "Article.ownerId"')
    await expect(database.query('Article', {
      fields: ['id'],
      where: { field: 'owner', operator: Operator.Comparison.Equal, value: '1' },
    })).rejects.toThrow('entity reference; graph projections are not supported yet')
    await expect(database.query('Article', {
      fields: ['id'],
      where: 'owner = "1"',
    })).rejects.toThrow('entity reference; graph projections are not supported yet')
    await expect(database.query('Article', {
      fields: ['id'],
      where: 'ownerId = "1"',
    })).rejects.toThrow('Unknown field "Article.ownerId"')

    await expect(database.query('Article', {
      fields: ['id'],
      orderBy: 'ownerId',
    })).rejects.toThrow('Unknown field "Article.ownerId"')
    await expect(database.query('Article', {
      fields: ['id'],
      orderBy: 'owner',
    })).rejects.toThrow('entity reference; graph projections are not supported yet')
  }, 120_000)

  isolatedTest('matches string and structured predicates with two-valued null semantics', async database => {
    // Raw nullable DDL exercises NULL semantics while the canonical entity drives query validation.
    await database.sql`
      create table "QueryRow" (
        "id" uuid primary key,
        "active" boolean,
        "externalId" bigint,
        "rank" double precision,
        "score" double precision,
        "title" text
      )
    `
    await database.sql`
          insert into "QueryRow" ("id", "active", "externalId", "rank", "score", "title")
          values
            (gen_random_uuid(), null, ${'9223372036854775807'}, 1, null, null),
            (gen_random_uuid(), true, null, 2, 0, ''),
            (gen_random_uuid(), false, null, 3, 5, '   '),
            (gen_random_uuid(), true, null, 4, 10, 'alpha'),
            (gen_random_uuid(), false, ${'9223372036854775807'}, 5, null, 'beta')
        `

    type Where = Filter | Readonly<Record<string, unknown>> | string
    const query = (where: Where) => database.query<{ rank: number }>('QueryRow', {
      fields: ['rank'],
      limit: null,
      orderBy: 'rank',
      where,
    })
    const same = async (source: string, structured: Where): Promise<void> => {
      expect(await query(source)).toEqual(await query(structured))
    }

    expect(await query('')).toEqual([{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 4 }, { rank: 5 }])
    await same('score >= 5 $and score < 10', {
      filters: [
        { field: 'score', operator: Operator.Comparison.GreaterThanOrEqual, value: 5 },
        { field: 'score', operator: Operator.Comparison.LessThan, value: 10 },
      ],
      operator: Operator.Logical.And,
    })
    expect(await query('score >= 5 $and score < 10')).toEqual([{ rank: 3 }])

    await same('score != 5', {
      field: 'score',
      operator: Operator.Comparison.NotEqual,
      value: 5,
    })
    expect(await query('score != 5')).toEqual([{ rank: 1 }, { rank: 2 }, { rank: 4 }, { rank: 5 }])

    await same('score $between [5, 10]', {
      field: 'score',
      operator: Operator.Comparison.Between,
      values: [5, 10],
    })
    expect(await query('score $between [5, 10]')).toEqual([{ rank: 3 }, { rank: 4 }])
    expect(await query('score $between [5, null]')).toEqual([{ rank: 3 }, { rank: 4 }])
    expect(await query('score $between [null, 5]')).toEqual([{ rank: 2 }, { rank: 3 }])

    await same('title $empty', {
      field: 'title',
      operator: Operator.Comparison.Empty,
    })
    expect(await query('title $empty')).toEqual([{ rank: 1 }, { rank: 2 }])
    await same('title !$empty', {
      filters: [{
        field: 'title',
        operator: Operator.Comparison.Empty,
      }],
      operator: Operator.Logical.Not,
    })
    expect(await query('title !$empty')).toEqual([{ rank: 3 }, { rank: 4 }, { rank: 5 }])

    await same('score = 5 $or score = 10', {
      filters: [
        { field: 'score', operator: Operator.Comparison.Equal, value: 5 },
        { field: 'score', operator: Operator.Comparison.Equal, value: 10 },
      ],
      operator: Operator.Logical.Or,
    })
    await same('$not (score = 5 $or score = 10)', {
      filters: [{
        filters: [
          { field: 'score', operator: Operator.Comparison.Equal, value: 5 },
          { field: 'score', operator: Operator.Comparison.Equal, value: 10 },
        ],
        operator: Operator.Logical.Or,
      }],
      operator: Operator.Logical.Not,
    })
    expect(await query('$not (score = 5 $or score = 10)'))
      .toEqual([{ rank: 1 }, { rank: 2 }, { rank: 5 }])
    await same('$not score > 5', {
      filters: [{
        field: 'score',
        operator: Operator.Comparison.GreaterThan,
        value: 5,
      }],
      operator: Operator.Logical.Not,
    })
    expect(await query('$not score > 5')).toEqual([{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 5 }])

    expect(await query('$not (score = 5 $or score = 10)'))
      .toEqual(await query('score != 5 $and score != 10'))
    expect(await query('$not (score = 5 $and title = "   ")'))
      .toEqual(await query('score != 5 $or title != "   "'))

    await same('score = null', { score: null })
    expect(await query('score = null')).toEqual([{ rank: 1 }, { rank: 5 }])
    await same('score != null', {
      field: 'score',
      operator: Operator.Comparison.NotEqual,
      value: null,
    })
    expect(await query('score != null')).toEqual([{ rank: 2 }, { rank: 3 }, { rank: 4 }])

    await same('externalId = 9223372036854775807', {
      field: 'externalId',
      operator: Operator.Comparison.Equal,
      value: '9223372036854775807',
    })
    expect(await query('externalId = 9223372036854775807')).toEqual([{ rank: 1 }, { rank: 5 }])
    await same('externalId $between [9223372036854775807, null]', {
      field: 'externalId',
      operator: Operator.Comparison.Between,
      values: ['9223372036854775807', null],
    })
    expect(await query('externalId $between [9223372036854775807, null]'))
      .toEqual([{ rank: 1 }, { rank: 5 }])

    await expect(database.query('QueryRow', {
      fields: ['rank'],
      where: 'missing = 1',
    })).rejects.toThrow('Unknown field "QueryRow.missing"')
    await expect(database.query('QueryRow', {
      fields: ['rank'],
      where: 'title = "unterminated',
    })).rejects.toThrow('Invalid where query at 8: Unterminated string literal')
  }, 120_000)

  test('rolls back successful isolated tests and shares the transaction with db.query', async () => {
    let schema = ''
    await withIsolatedDatabase('rollback-success', async database => {
      schema = database.schema
      await database.sql`
        create table "NumberRow" ("id" uuid primary key, "value" double precision not null)
      `
      await database.sql`
        insert into "NumberRow" ("id", "value") values (gen_random_uuid(), ${1.5})
      `
      expect(await database.query<{ value: number }>('NumberRow', {
        fields: ['value'],
        limit: null,
      })).toEqual([{ value: 1.5 }])
    })

    const { server } = await useDatabaseFixture('rollback-success-check')
    expect(await server.db.sql<{ present: boolean }[]>`
      select to_regclass(${`"${schema}"."NumberRow"`}) is not null as present
    `).toEqual([{ present: false }])
  }, 120_000)

  test('rolls back failed isolated tests', async () => {
    let schema = ''
    await expect(withIsolatedDatabase('rollback-failure', async database => {
      schema = database.schema
      await database.sql`create table "FailureProbe" ("id" uuid primary key)`
      throw new Error('forced isolated failure')
    })).rejects.toThrow('forced isolated failure')

    const { server } = await useDatabaseFixture('rollback-failure-check')
    expect(await server.db.sql<{ present: boolean }[]>`
      select to_regclass(${`"${schema}"."FailureProbe"`}) is not null as present
    `).toEqual([{ present: false }])
  }, 120_000)

  test('runs concurrent isolated tests in independent schemas', async () => {
    const schemas = await Promise.all([
      withIsolatedDatabase('concurrent-a', async database => {
        await database.sql`
          create table "NumberRow" ("id" uuid primary key, "value" double precision not null)
        `
        await database.sql`
          insert into "NumberRow" ("id", "value") values (gen_random_uuid(), ${1})
        `
        expect(await database.query<{ value: number }>('NumberRow', {
          fields: ['value'],
          limit: null,
        })).toEqual([{ value: 1 }])
        return database.schema
      }),
      withIsolatedDatabase('concurrent-b', async database => {
        await database.sql`
          create table "NumberRow" ("id" uuid primary key, "value" double precision not null)
        `
        await database.sql`
          insert into "NumberRow" ("id", "value") values (gen_random_uuid(), ${2})
        `
        expect(await database.query<{ value: number }>('NumberRow', {
          fields: ['value'],
          limit: null,
        })).toEqual([{ value: 2 }])
        return database.schema
      }),
    ])

    expect(new Set(schemas).size).toBe(2)
    const { server } = await useDatabaseFixture('concurrent-check')
    expect(await server.db.sql<{ count: number }[]>`
      select count(*)::int as count
      from pg_catalog.pg_namespace
      where nspname in (${schemas[0]}, ${schemas[1]})
    `).toEqual([{ count: 0 }])
  }, 120_000)

  test('cleans committed durable schemas after failures', async () => {
    let schema = ''
    await expect(withDurableDatabase('durable-failure', async database => {
      schema = database.schema
      await database.tx(async tx => {
        await tx`create table "DurableFailure" ("id" uuid primary key)`
      })
      throw new Error('forced durable failure')
    })).rejects.toThrow('forced durable failure')

    const { server } = await useDatabaseFixture('durable-failure-check')
    expect(await server.db.sql<{ present: boolean }[]>`
      select exists (
        select 1 from pg_catalog.pg_namespace where nspname = ${schema}
      ) as present
    `).toEqual([{ present: false }])
  }, 120_000)

  test('leaves no isolated database schemas behind', async () => {
    const { server } = await useDatabaseFixture('schema-leak-check')
    expect(await server.db.sql<{ count: number }[]>`
      select count(*)::int as count
      from pg_catalog.pg_namespace
      where nspname like 'basis_test_%'
    `).toEqual([{ count: 0 }])
  }, 30_000)

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
