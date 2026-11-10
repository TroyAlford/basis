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
import { withSeedDatabase } from '../testing/DatabaseSeed'
import { installSchema } from '../testing/Schema'
import { compileEntityQuery, queryEntity } from './Database'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'
import type { Filter } from './Predicate'
import { Server } from './Server'

/*
 * Real PostgreSQL lifecycle. The suite owns Docker services through the
 * server capability; it never replaces the database boundary with a mock.
 */

const root = join(import.meta.dir, '..', '..', '..')
const FAST_E2E = Bun.env.BASIS_E2E_FAST === '1'
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
 * Register a database test that needs a fresh schema, not the fixture schema.
 * @param name - Test name and fixture label.
 * @param callback - Test work.
 * @param timeout - Test timeout in milliseconds.
 */
function freshIsolatedTest(
  name: string,
  callback: (database: IsolatedDatabase) => Promise<void>,
  timeout = 120_000,
): void {
  test(name, () => withIsolatedDatabase(name, callback, { fresh: true }), timeout)
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
  test.skipIf(FAST_E2E)('supports independent installs, durable restart, and same-install reconnection', async () => {
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

  isolatedTest('exposes Bun SQL parameterization and error semantics', async database => {
    const injected = "Robert'); drop table users; --"
    const rows = await database.sql<{ text: string, value: number }[]>`
      SELECT ${injected} AS text, ${7} AS value
    `
    expect(rows[0]?.text).toBe(injected)
    expect(rows[0]?.value).toBe(7)

    const failure = await database.captureError(async db => {
      await db.sql`
        SELECT *
        FROM basis_missing_relation
      `
    })
    expect(failure).toMatchObject({ errno: '42P01' })
  })

  durableTest('commits and rolls back through pooled Bun transactions', async database => {
    await database.tx(async sql => {
      await sql`
        CREATE TABLE tx_probe (value text)
      `
    })

    const result = await database.tx(async sql => {
      await sql`
        INSERT INTO tx_probe
        VALUES ('committed')
      `
      return 'callback-result'
    })
    expect(result).toBe('callback-result')

    const count = async (): Promise<number | undefined> => (
      await database.tx(async sql => {
        const rows = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM tx_probe
        `
        return rows[0]?.count
      })
    )
    expect(await count()).toBe(1)

    await expect(database.tx(async sql => {
      await sql`
        INSERT INTO tx_probe
        VALUES ('thrown')
      `
      throw new Error('rollback')
    })).rejects.toThrow('rollback')
    expect(await count()).toBe(1)

    await expect(database.tx(async sql => {
      await sql`
        INSERT INTO tx_probe
        VALUES ('failed')
      `
      await sql`
        SELECT *
        FROM basis_missing_tx_relation
      `
    })).rejects.toMatchObject({ errno: '42P01' })
    expect(await count()).toBe(1)
  })

  isolatedTest('creates physical tables from canonical entities and reruns safely', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [noteDefinition, accountDefinition],
    }))
    await database.use(entities)
    await installSchema(database.sql, entities)

    const noteColumns = await database.sql<{
      columnName: string,
      dataType: string,
      isNullable: string,
      tableName: string,
    }[]>`
      SELECT table_name AS "tableName",
        column_name AS "columnName",
        data_type AS "dataType",
        is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ${'Note'}
      ORDER BY ordinal_position
    `
    const accountColumns = await database.sql<{
      columnName: string,
      dataType: string,
      isNullable: string,
      tableName: string,
    }[]>`
      SELECT table_name AS "tableName",
        column_name AS "columnName",
        data_type AS "dataType",
        is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ${'Account'}
      ORDER BY ordinal_position
    `
    expect([...noteColumns, ...accountColumns]).toEqual([
      { columnName: 'id', dataType: 'text', isNullable: 'NO', tableName: 'Note' },
      { columnName: 'title', dataType: 'text', isNullable: 'NO', tableName: 'Note' },
      { columnName: 'active', dataType: 'boolean', isNullable: 'NO', tableName: 'Note' },
      { columnName: 'score', dataType: 'double precision', isNullable: 'NO', tableName: 'Note' },
      { columnName: 'dueOn', dataType: 'date', isNullable: 'NO', tableName: 'Note' },
      { columnName: 'createdAt', dataType: 'timestamp with time zone', isNullable: 'NO', tableName: 'Note' },
      { columnName: 'id', dataType: 'text', isNullable: 'NO', tableName: 'Account' },
      { columnName: 'label', dataType: 'text', isNullable: 'NO', tableName: 'Account' },
    ])

    const primaryKeys = await database.sql<{ tableName: string }[]>`
      SELECT tc.table_name AS "tableName"
      FROM information_schema.table_constraints tc
WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = current_schema() AND tc.table_name IN
  (${'Note'},
        ${'Account'})
      ORDER BY tc.table_name
    `
    expect(primaryKeys.map(row => row.tableName)).toEqual(['Account', 'Note'])

    const keptId = randomUUID()
    const accountId = '9223372036854775807'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${keptId}, ${'kept'}, ${'Note'}), (${accountId}, ${'Troy'}, ${'Account'})
    `
    await database.sql`
      INSERT INTO "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
      VALUES (${keptId}, 'kept', TRUE, 1.5, '2026-01-02', now())
    `
    await database.sql`
      INSERT INTO "Account" ("id", "label")
      VALUES (${accountId}, ${'Troy'})
    `
    await installSchema(database.sql, entities)
    expect(await database.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Note"
    `)
      .toEqual([{ count: 1 }])
    expect(await database.sql<{ id: string }[]>`
      SELECT id
      FROM "Account"
    `)
      .toEqual([{ id: accountId }])
    expect(await database.query<{ id: string, label: string }>('Account', {
      fields: ['id', 'label'],
      where: { id: accountId },
    })).toEqual([{ id: accountId, label: 'Troy' }])
    expect(await database.query<{ score: number, title: string }>('Note', {
      fields: ['title', 'score'],
    })).toEqual([{ score: 1.5, title: 'kept' }])
  }, 120_000)

  durableTest('enforces Entity and User reference eligibility', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'email', type: 'String' },
          ],
          name: 'User',
        },
        {
          extends: 'User',
          fields: [
            { field: 'permissions', type: 'String' },
            { field: 'favorite', target: 'Entity', type: 'Entity' },
            { field: 'manager', target: 'User', type: 'Entity' },
          ],
          name: 'SystemUser',
        },
        {
          extends: 'User',
          fields: [{ field: 'company', type: 'String' }],
          name: 'Client',
        },
        {
          fields: [
            { field: 'id', format: 'Snowflake' },
            { field: 'title', type: 'String' },
          ],
          name: 'Book',
        },
        {
          extends: 'Book',
          fields: [{ field: 'genre', type: 'String' }],
          name: 'Novel',
        },
      ],
    }))
    await database.tx(async sql => installSchema(sql, entities))
    const userId = randomUUID()
    const novelId = '123'
    await database.tx(async sql => {
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${userId}, ${'User'}, ${'SystemUser'}), (${novelId}, ${'Novel'}, ${'Novel'})
      `
      await sql`
        INSERT INTO "User" ("id", "email")
        VALUES (${userId}, ${'user@example.test'})
      `
      await sql`
        INSERT INTO "SystemUser" ("id", "permissions", "favorite.id", "manager.id")
        VALUES (${userId}, ${'admin'}, ${novelId}, ${userId})
      `
      await sql`
        INSERT INTO "Book" ("id", "title")
        VALUES (${novelId}, ${'Book'})
      `
      await sql`
        INSERT INTO "Novel" ("id", "genre")
        VALUES (${novelId}, ${'Genre'})
      `
    })

    expect(await database.tx(async sql => queryEntity<{
      email: string,
      entity: string,
      id: string,
      name: string,
      permissions: string,
    }>(sql, entities, 'SystemUser', {
      fields: ['id', 'name', 'entity', 'email', 'permissions'],
      orderBy: 'email',
      where: { email: 'user@example.test' },
    }))).toEqual([{
      email: 'user@example.test',
      entity: 'SystemUser',
      id: userId,
      name: 'User',
      permissions: 'admin',
    }])
    expect(await database.tx(async sql => queryEntity<{ id: string }>(sql, entities, 'SystemUser', {
      fields: ['id'],
      limit: 1,
      orderBy: [],
    }))).toEqual([{ id: userId }])

    const invalidManager = await database.tx(async sql => sql`
      UPDATE "SystemUser"
      SET "manager.id" = ${novelId}
      WHERE "id" = ${userId}
    `).catch((error: unknown) => error)
    expect(invalidManager).toMatchObject({ errno: '23503' })
  }, 120_000)

  durableTest('projects descendant fields and singular reference paths', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'email', type: 'String' },
          ],
          name: 'User',
        },
        {
          extends: 'User',
          fields: [
            { field: 'permissions', type: 'String' },
            { field: 'status', type: 'String' },
            { field: 'manager', target: 'User', type: 'Entity' },
          ],
          name: 'SystemUser',
        },
        {
          extends: 'User',
          fields: [
            { field: 'company', type: 'String' },
            { field: 'status', type: 'String' },
          ],
          name: 'Client',
        },
        {
          fields: [
            { field: 'id', format: 'Snowflake' },
            { field: 'title', type: 'String' },
            { field: 'owner', target: 'User', type: 'Entity' },
            { field: 'favorite', target: 'Entity', type: 'Entity' },
          ],
          name: 'Article',
        },
      ],
    }))
    await database.tx(async sql => installSchema(sql, entities))
    const systemUserId = randomUUID()
    const clientOwnerId = randomUUID()
    const clientManagerId = randomUUID()
    await database.tx(async sql => {
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${systemUserId},
          ${'System User'},
          ${'SystemUser'}),
          (${clientOwnerId},
          ${'Client Owner'},
          ${'Client'}),
          (${clientManagerId},
          ${'Client Manager'},
          ${'Client'}),
          (${'1001'},
          ${'Article One'},
          ${'Article'}),
          (${'1002'},
          ${'Article Two'},
          ${'Article'}),
          (${'1003'},
          ${'Article Three'},
          ${'Article'}),
          (${'1004'},
          ${'Article Four'},
          ${'Article'})
      `
      await sql`
        INSERT INTO "User" ("id", "email")
VALUES (${systemUserId},
  ${'system@example.test'}),
  (${clientOwnerId},
  ${'owner@example.test'}),
  (${clientManagerId},
  ${'manager@example.test'})
      `
      await sql`
        INSERT INTO "SystemUser" ("id", "permissions", "status", "manager.id")
        VALUES (${systemUserId}, ${'admin'}, ${'active'}, ${clientManagerId})
      `
      await sql`
        INSERT INTO "Client" ("id", "company", "status")
VALUES (${clientOwnerId},
  ${'Acme'},
  ${'inactive'}),
  (${clientManagerId},
  ${'Manager Co'},
  ${'active'})
      `
      await sql`
        INSERT INTO "Article" ("id", "title", "owner.id", "favorite.id")
VALUES (${'1001'},
  ${'One'},
  ${systemUserId},
  ${systemUserId}),
  (${'1002'},
  ${'Two'},
  ${clientOwnerId},
  ${clientOwnerId}),
  (${'1003'},
  ${'Three'},
  ${null},
  ${'1001'}),
  (${'1004'},
  ${'Four'},
  ${null},
  ${null})
      `
    })

    expect(await database.tx(async sql => queryEntity<{
      entity: string,
      id: string,
      name: string,
      permissions: string | null,
      status: string,
    }>(sql, entities, 'User', {
      fields: ['id', 'name', 'entity', 'permissions', 'status'],
      limit: null,
      orderBy: 'name',
    }))).toEqual([
      {
        entity: 'Client',
        id: clientManagerId,
        name: 'Client Manager',
        permissions: null,
        status: 'active',
      },
      {
        entity: 'Client',
        id: clientOwnerId,
        name: 'Client Owner',
        permissions: null,
        status: 'inactive',
      },
      {
        entity: 'SystemUser',
        id: systemUserId,
        name: 'System User',
        permissions: 'admin',
        status: 'active',
      },
    ])

    expect(await database.tx(async sql => queryEntity<{
      entity: string,
      id: string,
      permissions: string | null,
    }>(sql, entities, 'User', {
      fields: ['id', 'entity', 'permissions'],
      limit: 1,
      offset: 1,
      orderBy: 'name',
    }))).toEqual([{ entity: 'Client', id: clientOwnerId, permissions: null }])

    expect(await database.tx(async sql => queryEntity<Record<string, unknown>>(sql, entities, 'User', {
      fields: ['id', 'entity', 'manager'],
      limit: null,
      orderBy: 'name',
    }))).toEqual([
      { entity: 'Client', id: clientManagerId, manager: null },
      { entity: 'Client', id: clientOwnerId, manager: null },
      {
        entity: 'SystemUser',
        id: systemUserId,
        manager: { entity: 'Client', id: clientManagerId, name: 'Client Manager' },
      },
    ])

    expect(await database.tx(async sql => queryEntity<Record<string, unknown>>(sql, entities, 'Article', {
      fields: ['id', 'title', 'owner'],
      limit: null,
      orderBy: 'id',
    }))).toEqual([
      {
        id: '1001',
        owner: { entity: 'SystemUser', id: systemUserId, name: 'System User' },
        title: 'One',
      },
      {
        id: '1002',
        owner: { entity: 'Client', id: clientOwnerId, name: 'Client Owner' },
        title: 'Two',
      },
      { id: '1003', owner: null, title: 'Three' },
      { id: '1004', owner: null, title: 'Four' },
    ])

    expect(await database.tx(async sql => queryEntity<Record<string, unknown>>(sql, entities, 'Article', {
      fields: ['id', 'owner.permissions'],
      limit: 1,
      offset: 1,
      orderBy: 'id',
    }))).toEqual([{
      id: '1002',
      owner: {
        entity: 'Client',
        id: clientOwnerId,
        name: 'Client Owner',
        permissions: null,
      },
    }])

    expect(await database.tx(async sql => queryEntity<Record<string, unknown>>(sql, entities, 'Article', {
      fields: ['id', 'owner.permissions'],
      limit: null,
      orderBy: 'id',
    }))).toEqual([
      {
        id: '1001',
        owner: {
          entity: 'SystemUser',
          id: systemUserId,
          name: 'System User',
          permissions: 'admin',
        },
      },
      {
        id: '1002',
        owner: {
          entity: 'Client',
          id: clientOwnerId,
          name: 'Client Owner',
          permissions: null,
        },
      },
      { id: '1003', owner: null },
      { id: '1004', owner: null },
    ])

    expect(await database.tx(async sql => queryEntity<Record<string, unknown>>(sql, entities, 'Article', {
      fields: ['id', 'owner.manager.name'],
      limit: null,
      orderBy: 'id',
    }))).toEqual([
      {
        id: '1001',
        owner: {
          entity: 'SystemUser',
          id: systemUserId,
          manager: {
            entity: 'Client',
            id: clientManagerId,
            name: 'Client Manager',
          },
          name: 'System User',
        },
      },
      {
        id: '1002',
        owner: {
          entity: 'Client',
          id: clientOwnerId,
          manager: null,
          name: 'Client Owner',
        },
      },
      { id: '1003', owner: null },
      { id: '1004', owner: null },
    ])

    expect(await database.tx(async sql => queryEntity<Record<string, unknown>>(sql, entities, 'Article', {
      fields: ['id', 'favorite'],
      limit: null,
      orderBy: 'id',
    }))).toEqual([
      {
        favorite: { entity: 'SystemUser', id: systemUserId, name: 'System User' },
        id: '1001',
      },
      {
        favorite: { entity: 'Client', id: clientOwnerId, name: 'Client Owner' },
        id: '1002',
      },
      {
        favorite: { entity: 'Article', id: '1001', name: 'Article One' },
        id: '1003',
      },
      { favorite: null, id: '1004' },
    ])

    expect(await database.tx(async sql => queryEntity<Record<string, unknown>>(sql, entities, 'Article', {
      fields: ['id', 'favorite.permissions'],
      limit: null,
      orderBy: 'id',
    }))).toEqual([
      {
        favorite: {
          entity: 'SystemUser',
          id: systemUserId,
          name: 'System User',
          permissions: 'admin',
        },
        id: '1001',
      },
      {
        favorite: {
          entity: 'Client',
          id: clientOwnerId,
          name: 'Client Owner',
          permissions: null,
        },
        id: '1002',
      },
      {
        favorite: {
          entity: 'Article',
          id: '1001',
          name: 'Article One',
          permissions: null,
        },
        id: '1003',
      },
      { favorite: null, id: '1004' },
    ])

    expect(await database.tx(async sql => queryEntity<Record<string, unknown>>(sql, entities, 'Article', {
      fields: ['id', 'favorite.permissions'],
      limit: 1,
      offset: 1,
      orderBy: 'id',
    }))).toEqual([{
      favorite: {
        entity: 'Client',
        id: clientOwnerId,
        name: 'Client Owner',
        permissions: null,
      },
      id: '1002',
    }])

    expect(await database.tx(async sql => queryEntity<Record<string, unknown>>(sql, entities, 'Article', {
      fields: ['id', 'favorite.owner.name'],
      limit: null,
      orderBy: 'id',
    }))).toEqual([
      {
        favorite: {
          entity: 'SystemUser',
          id: systemUserId,
          name: 'System User',
          owner: null,
        },
        id: '1001',
      },
      {
        favorite: {
          entity: 'Client',
          id: clientOwnerId,
          name: 'Client Owner',
          owner: null,
        },
        id: '1002',
      },
      {
        favorite: {
          entity: 'Article',
          id: '1001',
          name: 'Article One',
          owner: { entity: 'SystemUser', id: systemUserId, name: 'System User' },
        },
        id: '1003',
      },
      { favorite: null, id: '1004' },
    ])

    expect(await database.tx(async sql => queryEntity<Record<string, unknown>>(sql, entities, 'Article', {
      fields: ['id', 'owner.permissions'],
      limit: 1,
      orderBy: 'id',
      where: { title: 'One' },
    }))).toEqual([{
      id: '1001',
      owner: {
        entity: 'SystemUser',
        id: systemUserId,
        name: 'System User',
        permissions: 'admin',
      },
    }])

    expect(await database.tx(async sql => queryEntity<{ id: string }>(sql, entities, 'Article', {
      fields: ['id'],
      where: { 'owner.name': 'System User' },
    }))).toEqual([{ id: '1001' }])
    expect(await database.tx(async sql => queryEntity<{ id: string }>(sql, entities, 'Article', {
      fields: ['id'],
      where: "owner.permissions = 'admin'",
    }))).toEqual([{ id: '1001' }])
    expect(await database.tx(async sql => queryEntity<{ id: string }>(sql, entities, 'Article', {
      fields: ['id'],
      where: { 'owner.manager.name': 'Client Manager' },
    }))).toEqual([{ id: '1001' }])
    expect(await database.tx(async sql => queryEntity<{ id: string }>(sql, entities, 'Article', {
      fields: ['id'],
      where: {
        filters: [
          { field: 'owner', operator: Operator.Comparison.Equal, value: systemUserId },
          { field: 'favorite', operator: Operator.Comparison.Equal, value: systemUserId },
        ],
        operator: Operator.Logical.And,
      },
    }))).toEqual([{ id: '1001' }])
    expect(await database.tx(async sql => queryEntity<{ id: string }>(sql, entities, 'Article', {
      fields: ['id'],
      where: { 'owner.manager': clientManagerId },
    }))).toEqual([{ id: '1001' }])
    expect(await database.tx(async sql => queryEntity<{ id: string }>(sql, entities, 'Article', {
      fields: ['id'],
      orderBy: 'id',
      where: { owner: null },
    }))).toEqual([{ id: '1003' }, { id: '1004' }])
    expect(await database.tx(async sql => queryEntity<{ id: string }>(sql, entities, 'Article', {
      fields: ['id'],
      where: { owner: systemUserId },
    }))).toEqual([{ id: '1001' }])
    expect(await database.tx(async sql => queryEntity<{ id: string }>(sql, entities, 'User', {
      fields: ['id'],
      where: "permissions = 'admin'",
    }))).toEqual([{ id: systemUserId }])
    expect(await database.tx(async sql => queryEntity<{ id: string }>(sql, entities, 'Article', {
      fields: ['id'],
      where: { 'owner.name': 'Missing' },
    }))).toEqual([])

    await expect(database.tx(async sql => queryEntity(sql, entities, 'Article', {
      fields: ['title.value'],
    }))).rejects.toThrow('Cannot traverse scalar field')
    await database.tx(async sql => queryEntity(sql, entities, 'Article', {
      fields: ['owner.manager.manager.name'],
    }))
  }, 120_000)

  test.skipIf(FAST_E2E)('queries prebuilt polymorphic descendants with indexed names', async () => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'Snowflake' },
            { field: 'nickname', type: 'String' },
          ],
          name: 'Pet',
        },
        {
          extends: 'Pet',
          fields: [{ field: 'breed', type: 'String' }],
          name: 'Dog',
        },
        {
          extends: 'Pet',
          fields: [{ field: 'indoor', type: 'Boolean' }],
          name: 'Cat',
        },
      ],
    }))
    await withSeedDatabase(async ({ sql }) => {
      const options = {
        fields: ['id', 'name', 'entity', 'nickname'],
        limit: 10,
        orderBy: 'name',
        where: { field: 'name', operator: Operator.Comparison.Contains, value: 'pet-250000' },
      } as const
      const rows = await queryEntity<{
        entity: string,
        id: string,
        name: string,
        nickname: string,
      }>(sql, entities, 'Pet', options)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        entity: 'Dog',
        id: '250000',
        name: 'pet-250000',
        nickname: 'pet-250000',
      })

      const pageOne = await queryEntity<{ name: string }>(sql, entities, 'Pet', {
        fields: ['name'],
        limit: 3,
        orderBy: 'name',
      })
      const pageTwo = await queryEntity<{ name: string }>(sql, entities, 'Pet', {
        fields: ['name'],
        limit: 3,
        offset: 3,
        orderBy: 'name',
      })
      expect(pageOne.map(row => row.name)).toEqual(['pet-000001', 'pet-000002', 'pet-000003'])
      expect(pageTwo.map(row => row.name)).toEqual(['pet-000004', 'pet-000005', 'pet-000006'])

      expect(await queryEntity<{ name: string }>(sql, entities, 'Pet', {
        fields: ['name'],
        limit: 1,
        orderBy: [],
      })).toEqual([{ name: 'pet-000001' }])

      const compiled = compileEntityQuery(entities, 'Pet', options)
      const plan = await sql.unsafe<Record<string, string>[]>(
        `EXPLAIN (FORMAT TEXT) ${compiled.sql}`,
        [...compiled.values],
      )
      expect(plan.map(row => Object.values(row).join('\n')).join('\n'))
        .toContain('Entity_name_trgm_idx')
    })
  }, 300_000)

  durableTest('blocks partial fresh-schema initialization inside db.tx', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        { fields: [], name: 'Good' },
        { fields: [], name: 'Broken' },
      ],
    }))
    await database.tx(async sql => sql`
      CREATE TABLE "Broken" ("marker" text)
    `)
    const failure = await database.tx(async sql => installSchema(sql, entities)).catch((error: unknown) => error)
    expect(failure).toMatchObject({ message: expect.stringContaining('Migration plan has blocking drift') })
    expect(await database.tx(async sql => sql<{ entity: boolean, good: boolean }[]>`
SELECT to_regclass('"Entity"') IS NOT NULL AS entity,
  to_regclass('"Good"') IS NOT NULL AS good
    `)).toEqual([{ entity: false, good: false }])
  }, 120_000)

  isolatedTest('creates and indexes the universal identity root', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({ entities: [noteDefinition] }))
    await database.use(entities)
    await installSchema(database.sql, entities)

    expect(await database.sql<{ columnName: string, dataType: string, isNullable: string }[]>`
      SELECT column_name AS "columnName", data_type AS "dataType", is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Entity'
      ORDER BY ordinal_position
    `).toEqual([
      { columnName: 'id', dataType: 'text', isNullable: 'NO' },
      { columnName: 'name', dataType: 'text', isNullable: 'NO' },
      { columnName: 'entity', dataType: 'text', isNullable: 'NO' },
    ])
    expect(await database.sql<{ indexName: string }[]>`
      SELECT indexname AS "indexName"
      FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'Entity' AND indexname like 'Entity_name%'
      ORDER BY indexname
    `).toEqual([
      { indexName: 'Entity_name_id_idx' },
      { indexName: 'Entity_name_trgm_idx' },
    ])
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        'UUID',
        'Note'),
        ('0',
        'Zero',
        'Note'),
        ('-9223372036854775808',
        'Minimum',
        'Note'),
        ('9223372036854775807',
        'Maximum',
        'Note')
    `
    expect(await database.captureError(async db => {
      await db.sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES ('42', 'Abstract', 'User')
      `
    })).toMatchObject({ errno: '23514' })
  }, 120_000)

  isolatedTest('uses the entity model selected by use for queries', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'label', type: 'String' },
        ],
        name: 'Actor',
      }],
    }))
    await database.use(entities)
    const id = randomUUID()
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${id}, 'Actor', 'Actor')
    `
    await database.sql`
      INSERT INTO "Actor" ("id", "label")
      VALUES (${id}, 'Selected')
    `

    expect(await database.query<{ id: string, label: string }>('Actor', {
      fields: ['id', 'label'],
      where: { id },
    })).toEqual([{ id, label: 'Selected' }])
    await expect(database.query('Note', { fields: ['id'] }))
      .rejects.toThrow('Unknown entity "Note"')
  }, 120_000)

  isolatedTest('stores and queries named relationships and inverse references', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [{
            cardinality: 'Many',
            field: 'articles',
            inverse: 'author',
            target: 'Article',
            type: 'Inverse',
          }],
          name: 'User',
        },
        { fields: [], name: 'Campaign' },
        {
          fields: [
            { field: 'author', inverse: 'articles', target: 'User', type: 'Entity' },
            { field: 'tags', items: { type: 'String' }, type: 'Array' },
            { field: 'payload', type: 'JSON' },
          ],
          name: 'Article',
        },
      ],
      relationships: [{
        between: [
          { field: 'user', inverse: 'campaigns', target: 'User' },
          { field: 'campaign', inverse: 'members', target: 'Campaign' },
        ],
        fields: [
          { field: 'role', type: 'String' },
          { field: 'favorites', type: 'String' },
        ],
        name: 'Membership',
      }],
    }))
    await database.use(entities)

    expect(await database.sql<{
      columnName: string,
      dataType: string,
      isNullable: string,
      udtName: string,
    }[]>`
      SELECT column_name AS "columnName",
        data_type AS "dataType",
        is_nullable AS "isNullable",
        udt_name AS "udtName"
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Article'
      ORDER BY ordinal_position
    `).toEqual([
      { columnName: 'id', dataType: 'text', isNullable: 'NO', udtName: 'text' },
      { columnName: 'author.id', dataType: 'text', isNullable: 'YES', udtName: 'text' },
      { columnName: 'tags', dataType: 'ARRAY', isNullable: 'NO', udtName: '_text' },
      { columnName: 'payload', dataType: 'jsonb', isNullable: 'NO', udtName: 'jsonb' },
    ])
    expect(await database.sql<{ columnName: string, dataType: string, isNullable: string }[]>`
      SELECT column_name AS "columnName", data_type AS "dataType", is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Membership'
      ORDER BY ordinal_position
    `).toEqual([
      { columnName: 'user.id', dataType: 'text', isNullable: 'NO' },
      { columnName: 'campaign.id', dataType: 'text', isNullable: 'NO' },
      { columnName: 'role', dataType: 'text', isNullable: 'NO' },
      { columnName: 'favorites', dataType: 'text', isNullable: 'NO' },
    ])
    expect(await database.sql<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = '"Membership"'::regclass AND contype = 'p'
    `).toEqual([{ definition: 'PRIMARY KEY ("user.id", "campaign.id")' }])
    expect(await database.sql<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = '"Membership"'::regclass AND contype = 'f'
      ORDER BY conname
    `).toEqual([
      { definition: 'FOREIGN KEY ("campaign.id") REFERENCES "Campaign"(id) DEFERRABLE' },
      { definition: 'FOREIGN KEY ("user.id") REFERENCES "User"(id) DEFERRABLE' },
    ])
    expect((await database.sql<{ indexName: string }[]>`
      SELECT indexname AS "indexName"
      FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'Membership'
      ORDER BY indexname
    `).map(row => row.indexName)).toEqual([
      'Membership_campaign_idx',
      'Membership_pkey',
      'Membership_user_idx',
    ])

    const ada = '00000000-0000-4000-8000-000000000001'
    const grace = '00000000-0000-4000-8000-000000000002'
    const linus = '00000000-0000-4000-8000-000000000003'
    const campaign = '00000000-0000-4000-8000-000000000010'
    const secondCampaign = '00000000-0000-4000-8000-000000000011'
    const articleOne = '00000000-0000-4000-8000-000000000020'
    const articleTwo = '00000000-0000-4000-8000-000000000021'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${ada},
        'Ada',
        'User'),
        (${grace},
        'Grace',
        'User'),
        (${linus},
        'Linus',
        'User'),
        (${campaign},
        'Example Campaign',
        'Campaign'),
        (${secondCampaign},
        'Second Campaign',
        'Campaign'),
        (${articleOne},
        'Article One',
        'Article'),
        (${articleTwo},
        'Article Two',
        'Article')
    `
    await database.sql`
      INSERT INTO "User" ("id")
      VALUES (${ada}), (${grace}), (${linus})
    `
    await database.sql`
      INSERT INTO "Campaign" ("id")
      VALUES (${campaign}), (${secondCampaign})
    `
    await database.sql`
      INSERT INTO "Article" ("id", "author.id", "tags", "payload")
      VALUES (${articleOne},
        ${ada},
        ARRAY['one',
        'two'],
        '{"kind":"note"}'::jsonb),
        (${articleTwo},
        ${ada},
        ARRAY['three'],
        '{"kind":"memo"}'::jsonb)
    `
    await database.sql`
      INSERT INTO "Membership" ("user.id", "campaign.id", "role", "favorites")
      VALUES (${ada}, ${campaign}, 'GM', 'dice'), (${grace}, ${campaign}, 'Player', 'cards')
    `
    expect(await database.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Entity"
      WHERE "entity" = 'Membership'
    `).toEqual([{ count: 0 }])
    expect(await database.captureError(async db => {
      await db.sql`
        INSERT INTO "Membership" ("user.id", "campaign.id", "role", "favorites")
        VALUES (${ada}, ${campaign}, 'Duplicate', 'none')
      `
    })).toMatchObject({ errno: '23505' })
    expect(await database.captureError(async db => {
      await db.sql`
        INSERT INTO "Membership" ("user.id", "campaign.id", "role", "favorites")
        VALUES (${randomUUID()}, ${campaign}, 'Dangling', 'none')
      `
    })).toMatchObject({ errno: '23503' })

    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'User', {
      fields: ['id', 'name', 'articles'],
      where: { id: ada },
    })).toEqual([{
      articles: {
        items: [
          { entity: 'Article', id: articleOne, name: 'Article One' },
          { entity: 'Article', id: articleTwo, name: 'Article Two' },
        ],
        remaining: 0,
        total: 2,
      },
      id: ada,
      name: 'Ada',
    }])
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'Article', {
      fields: ['id', 'tags', 'payload'],
      orderBy: 'id',
      where: { id: articleOne },
    })).toEqual([{
      id: articleOne,
      payload: { kind: 'note' },
      tags: ['one', 'two'],
    }])

    const withProperties = await queryEntity<Record<string, unknown>>(database.sql, entities, 'Campaign', {
      collections: {
        members: { limit: 1, offset: 0, relationshipFields: ['role'] },
      },
      fields: ['id', 'name', 'members'],
      where: { id: campaign },
    })
    expect(withProperties).toEqual([{
      id: campaign,
      members: {
        items: [{
          entity: 'User',
          id: ada,
          membership: { role: 'GM' },
          name: 'Ada',
        }],
        remaining: 1,
        total: 2,
      },
      name: 'Example Campaign',
    }])
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'Campaign', {
      collections: { members: { limit: 2, offset: 0 } },
      fields: ['id', 'members'],
      where: { id: campaign },
    })).toEqual([{
      id: campaign,
      members: {
        items: [
          { entity: 'User', id: ada, name: 'Ada' },
          { entity: 'User', id: grace, name: 'Grace' },
        ],
        remaining: 0,
        total: 2,
      },
    }])
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'User', {
      collections: { campaigns: { relationshipFields: ['role'] } },
      fields: ['id', 'campaigns'],
      orderBy: 'id',
      where: { id: ada },
    })).toEqual([{
      campaigns: {
        items: [{
          entity: 'Campaign',
          id: campaign,
          membership: { role: 'GM' },
          name: 'Example Campaign',
        }],
        remaining: 0,
        total: 1,
      },
      id: ada,
    }])
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'User', {
      collections: { campaigns: { limit: 1, offset: 1 } },
      fields: ['id', 'campaigns'],
      where: { id: linus },
    })).toEqual([{
      campaigns: { items: [], remaining: 0, total: 0 },
      id: linus,
    }])

    await database.sql`
      INSERT INTO "Membership" ("user.id", "campaign.id", "role", "favorites")
      VALUES (${linus}, ${campaign}, 'Player', 'cards')
    `
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'Campaign', {
      collections: { members: { limit: 1, offset: 1 } },
      fields: ['id', 'members'],
      where: { id: campaign },
    })).toEqual([{
      id: campaign,
      members: {
        items: [{ entity: 'User', id: grace, name: 'Grace' }],
        remaining: 1,
        total: 3,
      },
    }])
    const multipleRoots = await queryEntity<Record<string, unknown>>(database.sql, entities, 'User', {
      collections: { campaigns: { limit: 1 } },
      fields: ['id', 'campaigns'],
      orderBy: 'id',
    })
    expect(multipleRoots.map(row => row.id)).toEqual([ada, grace, linus])
    expect(multipleRoots).toHaveLength(3)
  }, 120_000)

  isolatedTest('inherits relationship and inverse navigations on MTI descendants', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            {
              cardinality: 'Many',
              field: 'articles',
              inverse: 'author',
              target: 'Article',
              type: 'Inverse',
            },
          ],
          name: 'User',
        },
        {
          extends: 'User',
          fields: [{ field: 'permissions', type: 'String' }],
          name: 'SystemUser',
        },
        { fields: [], name: 'Campaign' },
        {
          fields: [{ field: 'author', inverse: 'articles', target: 'User', type: 'Entity' }],
          name: 'Article',
        },
      ],
      relationships: [{
        between: [
          { field: 'user', inverse: 'campaigns', target: 'User' },
          { field: 'campaign', inverse: 'members', target: 'Campaign' },
        ],
        fields: [
          { field: 'role', type: 'String' },
          { field: 'favorites', type: 'String' },
        ],
        name: 'Membership',
      }],
    }))
    await database.use(entities)
    const userId = '00000000-0000-4000-8000-000000000001'
    const campaignId = '00000000-0000-4000-8000-000000000002'
    const articleId = '00000000-0000-4000-8000-000000000003'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${userId},
        'Ada',
        'SystemUser'),
        (${campaignId},
        'Example Campaign',
        'Campaign'),
        (${articleId},
        'Article One',
        'Article')
    `
    await database.sql`
      INSERT INTO "User" ("id")
      VALUES (${userId})
    `
    await database.sql`
      INSERT INTO "SystemUser" ("id", "permissions")
      VALUES (${userId}, 'admin')
    `
    await database.sql`
      INSERT INTO "Campaign" ("id")
      VALUES (${campaignId})
    `
    await database.sql`
      INSERT INTO "Article" ("id", "author.id")
      VALUES (${articleId}, ${userId})
    `
    await database.sql`
      INSERT INTO "Membership" ("user.id", "campaign.id", "role", "favorites")
      VALUES (${userId}, ${campaignId}, 'GM', 'dice')
    `
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'SystemUser', {
      collections: { campaigns: { relationshipFields: ['role'] } },
      fields: ['id', 'campaigns', 'articles'],
      where: { id: userId },
    })).toEqual([{
      articles: {
        items: [{ entity: 'Article', id: articleId, name: 'Article One' }],
        remaining: 0,
        total: 1,
      },
      campaigns: {
        items: [{
          entity: 'Campaign',
          id: campaignId,
          membership: { role: 'GM' },
          name: 'Example Campaign',
        }],
        remaining: 0,
        total: 1,
      },
      id: userId,
    }])
  }, 120_000)

  freshIsolatedTest('supports reciprocal One and Many navigation with unique ownership', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            {
              cardinality: 'Many',
              field: 'pets',
              inverse: 'owner',
              target: 'Pet',
              type: 'Inverse',
            },
            {
              cardinality: 'One',
              field: 'pet',
              inverse: 'guardian',
              target: 'Pet',
              type: 'Inverse',
            },
          ],
          name: 'Person',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'owner', inverse: 'pets', target: 'Person', type: 'Entity' },
            { field: 'guardian', inverse: 'pet', target: 'Person', type: 'Entity' },
          ],
          name: 'Pet',
        },
      ],
    }))
    await database.use(entities)
    await installSchema(database.sql, entities)
    await installSchema(database.sql, entities)

    expect(await database.sql<{ indexName: string, isUnique: boolean }[]>`
      SELECT indexname AS "indexName", indisunique AS "isUnique"
      FROM pg_indexes
      JOIN pg_class ON pg_class.relname = indexname AND pg_class.relnamespace =
        current_schema()::regnamespace
      JOIN pg_index ON pg_index.indexrelid = pg_class.oid
      WHERE schemaname = current_schema() AND tablename = 'Pet' AND indexname LIKE 'Pet_%_fk_idx'
      ORDER BY indexname
    `).toEqual([
      { indexName: 'Pet_guardian_fk_idx', isUnique: true },
      { indexName: 'Pet_owner_fk_idx', isUnique: false },
    ])
    await database.sql`
      DROP INDEX "Pet_guardian_fk_idx"
    `
    await database.sql`
      CREATE UNIQUE INDEX "Pet_guardian_fk_idx" ON "Pet" ("id")
    `
    await expect(installSchema(database.sql, entities))
      .rejects.toThrow('index definition changed: Pet.Pet_guardian_fk_idx')
    await database.sql`
      DROP INDEX "Pet_guardian_fk_idx"
    `
    await database.sql`
      CREATE UNIQUE INDEX "Pet_guardian_fk_idx" ON "Pet" ("guardian.id")
      WHERE FALSE
    `
    await expect(installSchema(database.sql, entities))
      .rejects.toThrow('Migration plan has blocking drift')
    await database.sql`
      DROP INDEX "Pet_guardian_fk_idx"
    `
    await database.sql`
      CREATE UNIQUE INDEX "Pet_guardian_fk_idx" ON "Pet" ("guardian.id", lower("id"))
    `
    await expect(installSchema(database.sql, entities))
      .rejects.toThrow('Migration plan has blocking drift')
    await database.sql`
      DROP INDEX "Pet_guardian_fk_idx"
    `
    await database.sql`
      CREATE UNIQUE INDEX "Pet_guardian_fk_idx" ON "Pet" ("guardian.id") NULLS NOT DISTINCT
    `
    await expect(installSchema(database.sql, entities))
      .rejects.toThrow('Migration plan has blocking drift')
    await database.sql`
      DROP INDEX "Pet_guardian_fk_idx"
    `
    await installSchema(database.sql, entities)

    const personOne = '00000000-0000-4000-8000-000000000001'
    const personTwo = '00000000-0000-4000-8000-000000000002'
    const personThree = '00000000-0000-4000-8000-000000000003'
    const petOne = '00000000-0000-4000-8000-000000000011'
    const petTwo = '00000000-0000-4000-8000-000000000012'
    const petThree = '00000000-0000-4000-8000-000000000013'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${personOne},
        'Ada',
        'Person'),
        (${personTwo},
        'Grace',
        'Person'),
        (${personThree},
        'Linus',
        'Person'),
        (${petOne},
        'Pet One',
        'Pet'),
        (${petTwo},
        'Pet Two',
        'Pet'),
        (${petThree},
        'Pet Three',
        'Pet')
    `
    await database.sql`
      INSERT INTO "Person" ("id")
      VALUES (${personOne}), (${personTwo}), (${personThree})
    `
    await database.sql`
      INSERT INTO "Pet" ("id", "owner.id", "guardian.id")
VALUES (${petOne},
  ${personOne},
  ${personOne}),
  (${petTwo},
  ${personOne},
  ${null}),
  (${petThree},
  ${personTwo},
  ${personTwo})
    `
    expect(await database.captureError(async db => {
      await db.sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${'00000000-0000-4000-8000-000000000014'}, 'Duplicate', 'Pet')
      `
      await db.sql`
        INSERT INTO "Pet" ("id", "owner.id", "guardian.id")
        VALUES (${'00000000-0000-4000-8000-000000000014'}, ${personOne}, ${personOne})
      `
    })).toMatchObject({ errno: '23505' })

    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'Person', {
      collections: { pets: { limit: 1, offset: 0 } },
      fields: ['id', 'pet', 'pets'],
      orderBy: 'id',
      where: { id: personOne },
    })).toEqual([{
      id: personOne,
      pet: { entity: 'Pet', id: petOne, name: 'Pet One' },
      pets: {
        items: [{ entity: 'Pet', id: petOne, name: 'Pet One' }],
        remaining: 1,
        total: 2,
      },
    }])
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'Person', {
      fields: ['id', 'pet'],
      orderBy: 'id',
    })).toEqual([
      { id: personOne, pet: { entity: 'Pet', id: petOne, name: 'Pet One' } },
      { id: personTwo, pet: { entity: 'Pet', id: petThree, name: 'Pet Three' } },
      { id: personThree, pet: null },
    ])
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'Pet', {
      collections: { 'owner.pets': { limit: 1, offset: 0 } },
      fields: ['id', 'owner.pets'],
      where: { id: petOne },
    })).toEqual([{
      id: petOne,
      owner: {
        entity: 'Person',
        id: personOne,
        name: 'Ada',
        pets: {
          items: [{ entity: 'Pet', id: petOne, name: 'Pet One' }],
          remaining: 1,
          total: 2,
        },
      },
    }])
  }, 120_000)

  isolatedTest('evaluates collection contains, universal, and empty semantics on real edges', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'title', type: 'String' },
            {
              cardinality: 'Many',
              field: 'pets',
              inverse: 'owner',
              target: 'Pet',
              type: 'Inverse',
            },
          ],
          name: 'Person',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'age', type: 'Number' },
            { field: 'title', type: 'String' },
            { field: 'nickname', type: 'String' },
            { field: 'owner', inverse: 'pets', target: 'Person', type: 'Entity' },
            { field: 'vaccinated', type: 'Boolean' },
            { field: 'vet', target: 'Person', type: 'Entity' },
          ],
          name: 'Pet',
        },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Campaign' },
      ],
      relationships: [{
        between: [
          { field: 'person', inverse: 'campaigns', target: 'Person' },
          { field: 'campaign', inverse: 'members', target: 'Campaign' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'Membership',
      }],
    }))
    await database.use(entities)
    const ada = '00000000-0000-4000-8000-000000000001'
    const grace = '00000000-0000-4000-8000-000000000002'
    const linus = '00000000-0000-4000-8000-000000000003'
    const dana = '00000000-0000-4000-8000-000000000004'
    const rex = '00000000-0000-4000-8000-000000000011'
    const fido = '00000000-0000-4000-8000-000000000012'
    const rexTwo = '00000000-0000-4000-8000-000000000013'
    const fidoTwo = '00000000-0000-4000-8000-000000000014'
    const one = '00000000-0000-4000-8000-000000000021'
    const two = '00000000-0000-4000-8000-000000000022'
    const three = '00000000-0000-4000-8000-000000000023'
    const four = '00000000-0000-4000-8000-000000000024'
    const five = '00000000-0000-4000-8000-000000000025'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${ada},
        'Ada',
        'Person'),
        (${grace},
        'Grace',
        'Person'),
        (${linus},
        'Linus',
        'Person'),
        (${dana},
        'Dana',
        'Person'),
        (${rex},
        'Rex',
        'Pet'),
        (${fido},
        'Fido',
        'Pet'),
        (${rexTwo},
        'Rex Two',
        'Pet'),
        (${fidoTwo},
        'Fido Two',
        'Pet'),
        (${one},
        'Campaign One',
        'Campaign'),
        (${two},
        'Campaign Two',
        'Campaign'),
        (${three},
        'Campaign Three',
        'Campaign'),
        (${four},
        'Campaign Four',
        'Campaign'),
        (${five},
        'Campaign Five',
        'Campaign')
    `
    await database.sql`
      INSERT INTO "Person" ("id", "title")
      VALUES (${ada}, 'Ada'), (${grace}, 'Grace'), (${linus}, 'Linus'), (${dana}, 'Dana')
    `
    await database.sql`
      INSERT INTO "Pet" ("id", "age", "title", "nickname", "owner.id", "vaccinated", "vet.id")
      VALUES (${rex},
        3,
        'Rex',
        'Loud',
        ${ada},
        TRUE,
        ${grace}),
        (${fido},
        8,
        'Fido',
        'Quiet',
        ${ada},
        TRUE,
        ${null}),
        (${rexTwo},
        12,
        'Rex',
        'Special',
        ${grace},
        FALSE,
        ${grace}),
        (${fidoTwo},
        5,
        'Fido',
        'Other',
        ${dana},
        TRUE,
        ${null})
    `
    await database.sql`
      INSERT INTO "Campaign" ("id")
      VALUES (${one}), (${two}), (${three}), (${four}), (${five})
    `
    await database.sql`
      INSERT INTO "Membership" ("person.id", "campaign.id", "role")
      VALUES (${ada},
        ${one},
        'GM'),
        (${grace},
        ${one},
        'Player'),
        (${linus},
        ${one},
        'Player'),
        (${linus},
        ${two},
        'GM'),
        (${grace},
        ${three},
        'Player'),
        (${dana},
        ${four},
        'Player')
    `

    const ids = async (entity: string, where: string): Promise<unknown[]> => (
      await queryEntity<{ id: string }>(database.sql, entities, entity, {
        fields: ['id'],
        orderBy: 'id',
        where,
      })
    ).map(row => row.id)

    expect(await ids('Person', "pets $contains (title = 'Rex')")).toEqual([ada, grace])
    expect(await ids('Person', "pets ~= (title = 'Rex')")).toEqual([ada, grace])
    expect(await ids('Person', "pets !$contains (title = 'Rex')")).toEqual([linus, dana])
    expect(await ids('Person', "pets $not $contains (title = 'Rex')")).toEqual([linus, dana])
    expect(await ids('Person', "pets $all (title = 'Rex')")).toEqual([grace, linus])
    expect(await ids('Person', "pets $all (nickname = 'Special')")).toEqual([grace, linus])
    expect(await ids('Person', 'pets $empty')).toEqual([linus])
    expect(await ids('Person', 'pets !$empty')).toEqual([ada, grace, dana])
    expect(await ids('Person', "pets $contains (owner.title = 'Ada')")).toEqual([ada])
    expect(await ids('Person', `pets $contains (owner = '${ada}')`)).toEqual([ada])
    expect(await ids('Person', 'pets $contains (@.age > 10)')).toEqual([grace])
    expect(await ids('Person', 'pets $contains (age > 10)')).toEqual([grace])
    expect(await ids('Person', 'pets $contains (@.age >= 5)')).toEqual([ada, grace, dana])
    expect(await ids('Person', 'pets $all (@.age > 0)')).toEqual([ada, grace, linus, dana])
    expect(await ids('Person', 'pets $all (@.age > 5)')).toEqual([grace, linus])
    expect(await ids('Person', 'pets $contains (@.vaccinated = true)')).toEqual([ada, dana])
    expect(await ids('Person', `pets $contains (@ = '${rex}')`)).toEqual([ada])
    expect(await ids('Person', `pets $contains (@.id = '${rex}')`)).toEqual([ada])
    expect(await ids('Person', "pets $contains (title = 'Rex' $or title = 'Fido')"))
      .toEqual([ada, grace, dana])
    expect(await ids('Person', 'pets $contains (vet = null)')).toEqual([ada, dana])
    expect(await ids('Person', "pets $all (vet.title = 'Grace')")).toEqual([grace, linus])
    expect(await ids('Person', "pets $all (vet.title > 'A')")).toEqual([grace, linus])
    expect(await ids('Person', "pets $contains ($not (vet.title > 'A'))")).toEqual([ada, dana])

    expect(await ids('Person', "pets $contains [(title = 'Rex'), (nickname = 'Quiet')]"))
      .toEqual([ada])
    expect(await ids('Person', "pets $contains (title = 'Rex' $and nickname = 'Quiet')"))
      .toEqual([])
    expect(await ids('Person', "pets $contains (title = 'Rex' $and nickname = 'Special')"))
      .toEqual([grace])

    expect(await ids('Campaign', "members $contains (membership.role = 'GM')"))
      .toEqual([one, two])
    expect(await ids('Campaign', "members $contains (@.membership.role = 'GM')"))
      .toEqual([one, two])
    expect(await ids('Campaign', "members $all (@.membership.role = 'Player')"))
      .toEqual([three, four, five])
    expect(await ids('Campaign', "members !$contains (membership.role = 'GM')"))
      .toEqual([three, four, five])
    expect(await ids('Campaign', 'members $empty')).toEqual([five])
    expect(await ids('Campaign', "members $all (membership.role = 'Player')"))
      .toEqual([three, four, five])
    expect(await ids('Campaign', "members $contains [(membership.role = 'Player'), (title = 'Grace')]"))
      .toEqual([one, three])
    expect(await ids('Campaign', "members $contains (membership.role = 'GM' $and title = 'Linus')"))
      .toEqual([two])

    const projected = await queryEntity<{ id: string, pets: { total: number } }>(
      database.sql,
      entities,
      'Person',
      {
        collections: { pets: { limit: 1 } },
        fields: ['id', 'pets'],
        orderBy: 'id',
        where: "pets $contains (title = 'Rex')",
      },
    )
    expect(projected.map(row => row.id)).toEqual([ada, grace])
    expect(projected[0]?.pets.total).toBe(2)
  }, 120_000)

  isolatedTest('evaluates descendant fields and references inside collection predicates', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'title', type: 'String' },
            { field: 'manager', target: 'Person', type: 'Entity' },
            {
              cardinality: 'Many',
              field: 'pets',
              inverse: 'owner',
              target: 'Base',
              type: 'Inverse',
            },
          ],
          name: 'Person',
        },
        {
          fields: [
            { field: 'owner', inverse: 'pets', target: 'Person', type: 'Entity' },
            { field: 'label', type: 'String' },
          ],
          name: 'Base',
        },
        {
          extends: 'Base',
          fields: [
            { field: 'trait', type: 'String' },
            { field: 'mentor', target: 'Person', type: 'Entity' },
          ],
          name: 'Dog',
        },
        {
          extends: 'Base',
          fields: [{ field: 'lives', type: 'Number' }],
          name: 'Cat',
        },
      ],
    }))
    await database.use(entities)
    const ada = '00000000-0000-4000-8000-000000000001'
    const grace = '00000000-0000-4000-8000-000000000002'
    const linus = '00000000-0000-4000-8000-000000000003'
    const dana = '00000000-0000-4000-8000-000000000004'
    const dogOne = '00000000-0000-4000-8000-000000000011'
    const dogTwo = '00000000-0000-4000-8000-000000000012'
    const dogThree = '00000000-0000-4000-8000-000000000013'
    const catOne = '00000000-0000-4000-8000-000000000014'
    const catTwo = '00000000-0000-4000-8000-000000000015'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${ada},
        'Ada',
        'Person'),
        (${grace},
        'Grace',
        'Person'),
        (${linus},
        'Linus',
        'Person'),
        (${dana},
        'Dana',
        'Person'),
        (${dogOne},
        'Dog One',
        'Dog'),
        (${dogTwo},
        'Dog Two',
        'Dog'),
        (${dogThree},
        'Dog Three',
        'Dog'),
        (${catOne},
        'Cat One',
        'Cat'),
        (${catTwo},
        'Cat Two',
        'Cat')
    `
    await database.sql`
      INSERT INTO "Person" ("id", "title", "manager.id")
VALUES (${ada},
  'Ada',
  ${null}),
  (${grace},
  'Grace',
  ${ada}),
  (${linus},
  'Linus',
  ${null}),
  (${dana},
  'Dana',
  ${null})
    `
    await database.sql`
      INSERT INTO "Base" ("id", "owner.id", "label")
      VALUES (${dogOne},
        ${ada},
        'Dog One'),
        (${dogTwo},
        ${grace},
        'Dog Two'),
        (${dogThree},
        ${grace},
        'Dog Three'),
        (${catOne},
        ${ada},
        'Cat One'),
        (${catTwo},
        ${dana},
        'Cat Two')
    `
    await database.sql`
      INSERT INTO "Dog" ("id", "trait", "mentor.id")
VALUES (${dogOne},
  'good',
  ${grace}),
  (${dogTwo},
  'good',
  ${ada}),
  (${dogThree},
  'good',
  ${null})
    `
    await database.sql`
      INSERT INTO "Cat" ("id", "lives")
      VALUES (${catOne}, 9), (${catTwo}, 9)
    `

    const ids = async (entity: string, where: string): Promise<unknown[]> => (
      await queryEntity<{ id: string }>(database.sql, entities, entity, {
        fields: ['id'],
        orderBy: 'id',
        where,
      })
    ).map(row => row.id)

    expect(await ids('Person', "pets $contains (trait = 'good')")).toEqual([ada, grace])
    expect(await ids('Person', "pets $all (trait = 'good')")).toEqual([grace, linus])
    expect(await ids('Person', "pets !$contains (trait = 'good')")).toEqual([linus, dana])
    expect(await ids('Person', 'pets $empty')).toEqual([linus])
    expect(await ids('Person', 'pets $contains (lives = 9)')).toEqual([ada, dana])
    expect(await ids('Person', "pets $contains (mentor.title = 'Grace')")).toEqual([ada])
    expect(await ids('Person', `pets $contains (mentor = '${grace}')`)).toEqual([ada])
    expect(await ids('Person', "pets $contains (mentor.manager.title = 'Ada')")).toEqual([ada])
    expect(await ids('Person', "pets $contains (mentor.title = 'Ada')")).toEqual([grace])
    expect(await ids('Person', "pets $all (mentor.title = 'Grace')")).toEqual([linus])

    const nineHops = Array.from({ length: 8 }, () => 'manager').join('.')
    expect(() => compileEntityQuery(entities, 'Person', {
      fields: ['id'],
      where: `pets $contains (mentor.${nineHops}.title = 'x')`,
    })).toThrow('maximum depth')
  }, 120_000)

  isolatedTest('evaluates native Array and opaque JSON predicates', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'tags', items: { type: 'String' }, type: 'Array' },
          { field: 'scores', items: { type: 'Number' }, type: 'Array' },
          { field: 'payload', type: 'JSON' },
        ],
        name: 'Note',
      }],
    }))
    await database.use(entities)
    const one = '00000000-0000-4000-8000-000000000001'
    const two = '00000000-0000-4000-8000-000000000002'
    const three = '00000000-0000-4000-8000-000000000003'
    const four = '00000000-0000-4000-8000-000000000004'
    const five = '00000000-0000-4000-8000-000000000005'
    const six = '00000000-0000-4000-8000-000000000006'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${one},
        'One',
        'Note'),
        (${two},
        'Two',
        'Note'),
        (${three},
        'Three',
        'Note'),
        (${four},
        'Four',
        'Note'),
        (${five},
        'Five',
        'Note'),
        (${six},
        'Six',
        'Note')
    `
    await database.sql`
      INSERT INTO "Note" ("id", "tags", "scores", "payload")
      VALUES (${one},
        ARRAY['urgent',
        'important'],
        ARRAY[1,
        2,
        2],
        '{"kind":"note","meta":{"active":true}}'::jsonb),
        (${two},
        ARRAY['urgent'],
        ARRAY[3],
        '{"kind":"other"}'::jsonb),
        (${three},
        ARRAY[]::text[],
        ARRAY[]::double precision[],
        '{}'::jsonb),
        (${four},
        ARRAY['b',
        'a'],
        ARRAY[2,
        1,
        1],
        '["a","b"]'::jsonb),
        (${five},
        ARRAY['a',
        'b'],
        ARRAY[1,
        2],
        '{"kind":"note"}'::jsonb),
        (${six},
        ARRAY['c'],
        ARRAY[4],
        '{"kind":null}'::jsonb)
    `

    const ids = async (where: string): Promise<unknown[]> => (
      await queryEntity<{ id: string }>(database.sql, entities, 'Note', {
        fields: ['id'],
        orderBy: 'id',
        where,
      })
    ).map(row => row.id)

    expect(await ids("tags $contains 'urgent'")).toEqual([one, two])
    expect(await ids("tags $contains ['urgent', 'important']")).toEqual([one])
    expect(await ids("tags ~= ['urgent']")).toEqual([one, two])
    expect(await ids("tags $overlaps ['important', 'missing']")).toEqual([one])
    expect(await ids('tags $overlaps []')).toEqual([])
    expect(await ids('tags $contains []')).toEqual([one, two, three, four, five, six])
    expect(await ids('tags $empty')).toEqual([three])
    expect(await ids('tags !$empty')).toEqual([one, two, four, five, six])
    expect(await ids("tags == ['b', 'a']")).toEqual([four, five])
    expect(await ids("tags === ['b', 'a']")).toEqual([four])
    expect(await ids('tags == []')).toEqual([three])
    expect(await ids('tags === []')).toEqual([three])
    expect(await ids("tags == ['missing']")).toEqual([])
    expect(await ids('scores == [1, 2]')).toEqual([one, four, five])
    expect(await ids('scores === [1, 2]')).toEqual([five])
    expect(await ids('scores $contains [2]')).toEqual([one, four, five])
    expect(await ids('scores $contains (@ >= 2)')).toEqual([one, two, four, five, six])
    expect(await ids('scores $all (@ > 0)')).toEqual([one, two, three, four, five, six])
    expect(await ids('scores $all (@ > 1)')).toEqual([two, three, six])
    expect(await ids('scores $contains (@ > 5 $and @ < 20)')).toEqual([])
    expect(await ids('scores $contains [(@ = 1), (@ = 2)]')).toEqual([one, four, five])
    expect(await ids('scores $contains (@ = 1 $and @ = 2)')).toEqual([])
    expect(await ids("tags $all (@ != 'urgent')")).toEqual([three, four, five, six])
    expect(await ids("tags $contains (@ != 'urgent')")).toEqual([one, four, five, six])
    expect(await ids("tags $contains (@ $contains 'port')")).toEqual([one])
    expect(await ids("payload $contains {kind: 'note'}")).toEqual([one, five])
    expect(await ids('payload $contains {meta: {active: true}}')).toEqual([one])
    expect(await ids('payload $contains {meta: {active: false}}')).toEqual([])
    expect(await ids("payload $contains ['a', 'b']")).toEqual([four])
    expect(await ids('payload $contains {kind: null}')).toEqual([six])
    expect(() => compileEntityQuery(entities, 'Note', {
      fields: ['id'],
      where: "scores $contains 'urgent'",
    })).toThrow('not a valid number value')
    expect(() => compileEntityQuery(entities, 'Note', {
      fields: ['id'],
      where: 'tags $contains [null]',
    })).toThrow('cannot contain null')
    expect(() => compileEntityQuery(entities, 'Note', {
      fields: ['id'],
      where: 'payload $eq {}',
    })).toThrow('not valid')
  }, 120_000)

  isolatedTest('rejects unsafe JSON numeric literals without matching neighbors', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'payload', type: 'JSON' },
        ],
        name: 'Note',
      }],
    }))
    await database.use(entities)
    const exact = '00000000-0000-4000-8000-000000000001'
    const unsafe = '00000000-0000-4000-8000-000000000002'
    const decimal = '00000000-0000-4000-8000-000000000003'
    const precise = '00000000-0000-4000-8000-000000000004'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${exact},
        'Exact',
        'Note'),
        (${unsafe},
        'Unsafe',
        'Note'),
        (${decimal},
        'Decimal',
        'Note'),
        (${precise},
        'Precise',
        'Note')
    `
    await database.sql`
      INSERT INTO "Note" ("id", "payload")
      VALUES (${exact},
        '{"account":9007199254740991}'::jsonb),
        (${unsafe},
        '{"account":9007199254740993}'::jsonb),
        (${decimal},
        '{"amount":1}'::jsonb),
        (${precise},
        '{"amount":1.0000000000000001}'::jsonb)
    `
    expect(await queryEntity<{ id: string }>(database.sql, entities, 'Note', {
      fields: ['id'],
      where: 'payload $contains {account: 9007199254740991}',
    })).toEqual([{ id: exact }])
    expect(await queryEntity<{ id: string }>(database.sql, entities, 'Note', {
      fields: ['id'],
      where: 'payload $contains {amount: 1}',
    })).toEqual([{ id: decimal }])
    expect(() => compileEntityQuery(entities, 'Note', {
      fields: ['id'],
      where: 'payload $contains {account: 9007199254740993}',
    })).toThrow('safe integer range')
    expect(() => compileEntityQuery(entities, 'Note', {
      fields: ['id'],
      where: 'payload $contains {amount: 1.0000000000000001}',
    })).toThrow('cannot be represented exactly')
    expect(() => compileEntityQuery(entities, 'Note', {
      fields: ['id'],
      where: {
        field: 'payload',
        operator: Operator.Comparison.Contains,
        value: { account: 9007199254740992 },
      },
    })).toThrow('safe integer range')
  }, 120_000)

  freshIsolatedTest('rejects index name collisions on fresh tables', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [{
            cardinality: 'One',
            field: 'pet',
            inverse: 'owner',
            target: 'Pet',
            type: 'Inverse',
          }, { field: 'id', format: 'UUID' }],
          name: 'Person',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'owner', inverse: 'pet', target: 'Person', type: 'Entity' },
          ],
          name: 'Pet',
        },
      ],
    }))
    await database.sql`
      CREATE TABLE "Other" ("id" text PRIMARY KEY)
    `
    await database.sql`
      CREATE UNIQUE INDEX "Pet_owner_fk_idx" ON "Other" ("id")
    `
    await expect(installSchema(database.sql, entities))
      .rejects.toThrow('Migration plan has blocking drift')
  }, 120_000)

  freshIsolatedTest('rejects nonindex relation names reserved for canonical indexes', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [{
            cardinality: 'One',
            field: 'pet',
            inverse: 'owner',
            target: 'Pet',
            type: 'Inverse',
          }, { field: 'id', format: 'UUID' }],
          name: 'Person',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'owner', inverse: 'pet', target: 'Person', type: 'Entity' },
          ],
          name: 'Pet',
        },
      ],
    }))
    await database.sql`
      CREATE TABLE "Pet_owner_fk_idx" ("id" text PRIMARY KEY)
    `
    await expect(installSchema(database.sql, entities))
      .rejects.toThrow('unexpected table: Pet_owner_fk_idx')
  }, 120_000)

  isolatedTest('projects inverse navigations for inherited and multiple roots', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            {
              cardinality: 'Many',
              field: 'visits',
              inverse: 'pet',
              target: 'Visit',
              type: 'Inverse',
            },
          ],
          name: 'Pet',
        },
        {
          fields: [
            { field: 'id', format: 'Snowflake' },
            { field: 'pet', inverse: 'visits', target: 'Pet', type: 'Entity' },
          ],
          name: 'Visit',
        },
        {
          extends: 'Visit',
          fields: [{ field: 'notes', type: 'String' }],
          name: 'SpecialVisit',
        },
      ],
    }))
    await database.use(entities)
    const petOne = '00000000-0000-4000-8000-000000000001'
    const petTwo = '00000000-0000-4000-8000-000000000002'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${petOne},
        'Pet One',
        'Pet'),
        (${petTwo},
        'Pet Two',
        'Pet'),
        ('1001',
        'Special Visit',
        'SpecialVisit'),
        ('1002',
        'Second Special Visit',
        'SpecialVisit')
    `
    await database.sql`
      INSERT INTO "Pet" ("id")
      VALUES (${petOne}), (${petTwo})
    `
    await database.sql`
      INSERT INTO "Visit" ("id", "pet.id")
      VALUES ('1001', ${petOne}), ('1002', ${petOne})
    `
    await database.sql`
      INSERT INTO "SpecialVisit" ("id", "notes")
      VALUES ('1001', 'note'), ('1002', 'other')
    `
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'Pet', {
      fields: ['id', 'visits'],
      orderBy: 'id',
    })).toEqual([
      {
        id: petOne,
        visits: {
          items: [
            { entity: 'SpecialVisit', id: '1001', name: 'Special Visit' },
            { entity: 'SpecialVisit', id: '1002', name: 'Second Special Visit' },
          ],
          remaining: 0,
          total: 2,
        },
      },
      {
        id: petTwo,
        visits: { items: [], remaining: 0, total: 0 },
      },
    ])
  }, 120_000)

  durableTest('enforces MTI final-state integrity for direct SQL', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'email', type: 'String' },
          ],
          name: 'User',
        },
        {
          extends: 'User',
          fields: [
            { field: 'permissions', type: 'String' },
            { field: 'manager', target: 'User', type: 'Entity' },
          ],
          name: 'SystemUser',
        },
        {
          extends: 'User',
          fields: [{ field: 'company', type: 'String' }],
          name: 'Client',
        },
        {
          fields: [
            { field: 'id', format: 'Snowflake' },
            { field: 'title', type: 'String' },
          ],
          name: 'Book',
        },
        {
          extends: 'Book',
          fields: [{ field: 'genre', type: 'String' }],
          name: 'Novel',
        },
      ],
    }))
    await database.tx(async sql => installSchema(sql, entities))

    const incompleteId = randomUUID()
    expect(await database.tx(async sql => sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${incompleteId}, ${'Incomplete'}, ${'SystemUser'})
    `).catch((error: unknown) => error)).toMatchObject({ errno: 'P0001' })

    const missingParentId = randomUUID()
    expect(await database.tx(async sql => {
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${missingParentId}, ${'Missing parent'}, ${'SystemUser'})
      `
      await sql`
        INSERT INTO "SystemUser" ("id", "permissions", "manager.id")
        VALUES (${missingParentId}, ${'admin'}, ${missingParentId})
      `
    }).catch((error: unknown) => error)).toMatchObject({ errno: '23503' })

    const id = randomUUID()
    await database.tx(async sql => {
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${id}, ${'Ada'}, ${'SystemUser'})
      `
      await sql`
        INSERT INTO "User" ("id", "email")
        VALUES (${id}, ${'ada@example.test'})
      `
      await sql`
        INSERT INTO "SystemUser" ("id", "permissions", "manager.id")
        VALUES (${id}, ${'admin'}, ${id})
      `
    })

    expect(await database.tx(async sql => sql`
      INSERT INTO "Client" ("id", "company")
      VALUES (${id}, ${'Hooli'})
    `).catch((error: unknown) => error)).toMatchObject({ errno: 'P0001' })

    await database.tx(async sql => {
      await sql`
        INSERT INTO "Client" ("id", "company")
        VALUES (${id}, ${'Temporary'})
      `
      await sql`
        DELETE FROM "Client"
        WHERE "id" = ${id}
      `
    })

    const replacementId = randomUUID()
    expect(await database.tx(async sql => {
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${replacementId}, ${'Replacement'}, ${'SystemUser'})
      `
      await sql`
        INSERT INTO "User" ("id", "email")
        VALUES (${replacementId}, ${'replacement@example.test'})
      `
      await sql`
        UPDATE "SystemUser"
        SET "id" = ${replacementId}
        WHERE "id" = ${id}
      `
    }).catch((error: unknown) => error)).toMatchObject({ errno: 'P0001' })

    expect(await database.tx(async sql => sql`
      DELETE FROM "SystemUser"
      WHERE "id" = ${id}
    `).catch((error: unknown) => error)).toMatchObject({ errno: 'P0001' })

    expect(await database.tx(async sql => sql`
      UPDATE "Entity"
      SET "entity" = ${'Client'}
      WHERE "id" = ${id}
    `).catch((error: unknown) => error)).toMatchObject({ errno: 'P0001' })

    const transientId = randomUUID()
    await database.tx(async sql => {
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${transientId}, ${'Transient'}, ${'SystemUser'})
      `
      await sql`
        INSERT INTO "User" ("id", "email")
        VALUES (${transientId}, ${'transient@example.test'})
      `
      await sql`
        INSERT INTO "SystemUser" ("id", "permissions", "manager.id")
        VALUES (${transientId}, ${'admin'}, ${transientId})
      `
      await sql`
        DELETE FROM "SystemUser"
        WHERE "id" = ${transientId}
      `
      await sql`
        DELETE FROM "User"
        WHERE "id" = ${transientId}
      `
      await sql`
        DELETE FROM "Entity"
        WHERE "id" = ${transientId}
      `
    })

    const novelId = '123'
    await database.tx(async sql => {
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${novelId}, ${'Novel'}, ${'Novel'})
      `
      await sql`
        INSERT INTO "Book" ("id", "title")
        VALUES (${novelId}, ${'Book'})
      `
      await sql`
        INSERT INTO "Novel" ("id", "genre")
        VALUES (${novelId}, ${'Genre'})
      `
    })
    await database.tx(async sql => {
      await sql`
        DELETE FROM "Novel"
        WHERE "id" = ${novelId}
      `
      await sql`
        DELETE FROM "Book"
        WHERE "id" = ${novelId}
      `
      await sql`
        DELETE FROM "Entity"
        WHERE "id" = ${novelId}
      `
    })

    const triggerOid = async () => database.tx(async sql => sql<{ oid: number }[]>`
      SELECT oid
      FROM pg_catalog.pg_trigger
      WHERE tgname = 'Entity_leaf_check' AND tgrelid = '"Entity"'::regclass
    `)
    const before = await triggerOid()
    await database.tx(async sql => installSchema(sql, entities))
    expect(await triggerOid()).toEqual(before)

    await database.tx(async sql => {
      await sql`
        DELETE FROM "SystemUser"
        WHERE "id" = ${id}
      `
      await sql`
        DELETE FROM "User"
        WHERE "id" = ${id}
      `
      await sql`
        DELETE FROM "Entity"
        WHERE "id" = ${id}
      `
    })
    expect(await database.tx(async sql => sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Entity"
      WHERE "id" = ${id}
    `)).toEqual([{ count: 0 }])

    await database.tx(async sql => sql`
      ALTER TABLE "Entity" disable trigger "Entity_leaf_check"
    `)
    expect(await database.tx(async sql => installSchema(sql, entities)).catch((error: unknown) => error))
      .toHaveProperty('message', expect.stringContaining('trigger definition changed: Entity_leaf_check'))
    await database.tx(async sql => sql`
      ALTER TABLE "Entity" enable trigger "Entity_leaf_check"
    `)

    await database.tx(async sql => sql`
      DROP trigger "Entity_leaf_immutable" ON "Entity"
    `)
    await database.tx(async sql => sql`
      CREATE trigger "Entity_leaf_immutable" before
      UPDATE of "name" ON "Entity" FOR each row execute function "Entity_leaf_immutable"()
    `)
    expect(await database.tx(async sql => installSchema(sql, entities)).catch((error: unknown) => error))
      .toHaveProperty('message', expect.stringContaining('trigger definition changed: Entity_leaf_immutable'))

    await database.tx(async sql => {
      await sql.unsafe(
        'create or replace function "Entity_leaf_immutable"() returns trigger ' +
        'language plpgsql as $$begin return new; end$$',
      ).simple()
    })
    expect(await database.tx(async sql => installSchema(sql, entities)).catch((error: unknown) => error))
      .toHaveProperty('message', expect.stringContaining('function definition changed: Entity_leaf_immutable'))
  }, 120_000)

  isolatedTest('filters numeric values with each comparison operator', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [numberRowDefinition],
    }))
    await database.use(entities)
    await database.sql`
      WITH rows AS (SELECT gen_random_uuid()::text AS id,
        value FROM generate_series(1,
        10) AS series(value) ),
        roots AS (INSERT INTO "Entity" ("id",
        "name",
        "entity") SELECT id,
        'Number ' || value,
        'NumberRow' FROM rows )
      INSERT INTO "NumberRow" ("id", "value")
      SELECT id, value
      FROM rows
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
            { field: 'id', format: 'UUID' },
            { field: 'author', target: 'User', type: 'Entity' },
            { field: 'title', type: 'String' },
          ],
          name: 'Post',
        },
        {
          fields: [
            { field: 'id', format: 'Snowflake' },
            { field: 'label', type: 'String' },
          ],
          name: 'User',
        },
      ],
    }))

    await database.use(entities)

    const constraints = await database.sql<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = '"Post"'::regclass AND contype = 'f'
      ORDER BY conname collate "C"
    `
    expect(constraints).toEqual([
      { definition: 'FOREIGN KEY (id) REFERENCES "Entity"(id) DEFERRABLE' },
      { definition: 'FOREIGN KEY ("author.id") REFERENCES "User"(id) DEFERRABLE' },
    ])

    const userId = '9223372036854775807'
    const postId = randomUUID()
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${userId}, ${'Ada'}, ${'User'}), (${postId}, ${'Hello'}, ${'Post'})
    `
    await database.sql`
      INSERT INTO "User" ("id", "label")
      VALUES (${userId}, ${'Ada'})
    `
    await database.sql`
      INSERT INTO "Post" ("id", "author.id", "title")
      VALUES (${postId}, ${userId}, ${'Hello'})
    `
    expect(await database.sql<{ userId: string }[]>`
      SELECT "author.id"::text AS "userId"
      FROM "Post"
    `).toEqual([{ userId }])

    const invalidId = randomUUID()
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES (${invalidId}, ${'Invalid'}, ${'Post'})
    `
    const invalidInsert = await database.captureError(async db => {
      await db.sql`
        INSERT INTO "Post" ("id", "author.id", "title")
        VALUES (${invalidId}, ${'1'}, ${'Invalid'})
      `
    })
    expect(invalidInsert).toMatchObject({ errno: '23503' })

    const blockedDelete = await database.captureError(async db => {
      await db.sql`
        DELETE FROM "User"
        WHERE "id" = ${'9223372036854775807'}
      `
    })
    expect(blockedDelete).toMatchObject({ errno: '23503' })
    expect(await database.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "Post"
    `).toEqual([{ count: 1 }])
  }, 120_000)

  durableTest('creates cyclic foreign keys and validates deferred references', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'car', target: 'CycleCar', type: 'Entity' },
          ],
          name: 'CycleUser',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'user', target: 'CycleUser', type: 'Entity' },
          ],
          name: 'CycleCar',
        },
      ],
    }))

    await database.tx(async sql => installSchema(sql, entities))

    const constraints = await database.tx(async sql => sql<{
      deferrable: boolean,
      deferred: boolean,
      definition: string,
      name: string,
    }[]>`
      SELECT conname AS name,
        condeferrable AS DEFERRABLE,
        condeferred AS deferred,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid IN ('"CycleUser"'::regclass, '"CycleCar"'::regclass) AND contype = 'f'
      ORDER BY conname collate "C"
    `)
    expect(constraints.map(constraint => ({
      deferrable: constraint.deferrable,
      deferred: constraint.deferred,
      name: constraint.name,
    }))).toEqual([
      { deferrable: true, deferred: false, name: 'CycleCar_Entity_mti_fkey' },
      { deferrable: true, deferred: false, name: 'CycleCar_user_fkey' },
      { deferrable: true, deferred: false, name: 'CycleUser_Entity_mti_fkey' },
      { deferrable: true, deferred: false, name: 'CycleUser_car_fkey' },
    ])
    expect(constraints.every(constraint => constraint.definition.endsWith('DEFERRABLE')))
      .toBe(true)

    const userId = randomUUID()
    const carId = randomUUID()
    await database.tx(async sql => {
      await sql`
        SET constraints ALL deferred
      `
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${userId}, ${'User'}, ${'CycleUser'}), (${carId}, ${'Car'}, ${'CycleCar'})
      `
      await sql`
        INSERT INTO "CycleUser" ("id", "car.id")
        VALUES (${userId}, ${carId})
      `
      await sql`
        INSERT INTO "CycleCar" ("id", "user.id")
        VALUES (${carId}, ${userId})
      `
    })
    expect(await database.tx(async sql => sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "CycleUser"
    `)).toEqual([{ count: 1 }])

    const invalidCarId = randomUUID()
    const invalidUserId = randomUUID()
    const missingUserId = randomUUID()
    const invalid = await database.tx(async sql => {
      await sql`
        SET constraints ALL deferred
      `
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
VALUES (${invalidUserId},
  ${'Invalid user'},
  ${'CycleUser'}),
  (${invalidCarId},
  ${'Invalid car'},
  ${'CycleCar'})
      `
      await sql`
        INSERT INTO "CycleUser" ("id", "car.id")
        VALUES (${invalidUserId}, ${invalidCarId})
      `
      await sql`
        INSERT INTO "CycleCar" ("id", "user.id")
        VALUES (${invalidCarId}, ${missingUserId})
      `
    }).catch((error: unknown) => error)
    expect(invalid).toMatchObject({ errno: '23503' })

    await database.tx(async sql => installSchema(sql, entities))
    expect(await database.tx(async sql => sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pg_constraint
      WHERE conrelid IN ('"CycleUser"'::regclass, '"CycleCar"'::regclass) AND contype = 'f'
    `)).toEqual([{ count: 4 }])

    await database.tx(async sql => sql`
      ALTER TABLE "CycleUser" DROP CONSTRAINT "CycleUser_car_fkey"
    `)
    await database.tx(async sql => sql`
      ALTER TABLE "CycleUser" ADD CONSTRAINT "CycleUser_car_fkey" FOREIGN KEY ("car.id") REFERENCES
        "CycleCar" ("id")
    `)
    await expect(database.tx(async sql => installSchema(sql, entities)))
      .rejects.toThrow('constraint definition changed: CycleUser_car_fkey')

    await database.tx(async sql => sql`
      ALTER TABLE "CycleUser" DROP CONSTRAINT "CycleUser_car_fkey"
    `)
    await database.tx(async sql => sql`
      ALTER TABLE "CycleUser" ADD CONSTRAINT "CycleUser_car_fkey" FOREIGN KEY ("car.id") REFERENCES
        "CycleCar" ("id") ON DELETE cascade DEFERRABLE INITIALLY immediate
    `)
    await expect(database.tx(async sql => installSchema(sql, entities)))
      .rejects.toThrow('constraint definition changed: CycleUser_car_fkey')

    await database.tx(async sql => sql`
      ALTER TABLE "CycleUser" DROP CONSTRAINT "CycleUser_car_fkey"
    `)
    await database.tx(async sql => sql`
      ALTER TABLE "CycleUser" ADD CONSTRAINT "CycleUser_car_fkey" FOREIGN KEY ("car.id") REFERENCES
        "CycleCar" ("id") DEFERRABLE INITIALLY immediate NOT valid
    `)
    await expect(database.tx(async sql => installSchema(sql, entities)))
      .rejects.toThrow('constraint definition changed: CycleUser_car_fkey')

    await database.tx(async sql => sql`
      ALTER TABLE "CycleUser" DROP CONSTRAINT "CycleUser_car_fkey"
    `)
    await database.tx(async sql => installSchema(sql, entities))
    expect(await database.tx(async sql => sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pg_constraint
      WHERE conrelid = '"CycleUser"'::regclass AND conname = 'CycleUser_car_fkey'
    `)).toEqual([{ count: 1 }])
  }, 120_000)

  durableTest('enforces self-referential foreign keys', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'parent', target: 'TreeNode', type: 'Entity' },
        ],
        name: 'TreeNode',
      }],
    }))

    await database.tx(async sql => installSchema(sql, entities))

    const nodeId = randomUUID()
    await database.tx(async sql => {
      await sql`
        SET constraints ALL deferred
      `
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${nodeId}, ${'Node'}, ${'TreeNode'})
      `
      await sql`
        INSERT INTO "TreeNode" ("id", "parent.id")
        VALUES (${nodeId}, ${nodeId})
      `
    })
    expect(await database.tx(async sql => sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM "TreeNode"
    `)).toEqual([{ count: 1 }])

    const invalidNodeId = randomUUID()
    const invalid = await database.tx(async sql => {
      await sql`
        SET constraints ALL deferred
      `
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES (${invalidNodeId}, ${'Invalid node'}, ${'TreeNode'})
      `
      await sql`
        INSERT INTO "TreeNode" ("id", "parent.id")
        VALUES (${invalidNodeId}, ${randomUUID()})
      `
    }).catch((error: unknown) => error)
    expect(invalid).toMatchObject({ errno: '23503' })
  }, 120_000)

  isolatedTest('rejects physical reference columns and invalid graph paths', async database => {
    await expect(database.query('Article', { fields: ['ownerId'] }))
      .rejects.toThrow('Unknown field "Article.ownerId"')
    expect(compileEntityQuery(database.entities, 'Article', { fields: ['owner'] }).sql)
      .toContain('"owner__id"')

    await expect(database.query('Article', {
      fields: ['id'],
      where: { ownerId: '1' },
    })).rejects.toThrow('Unknown field "Article.ownerId"')
    expect(await database.query<{ id: string }>('Article', {
      fields: ['id'],
      where: { owner: '00000000-0000-4000-8000-000000000001' },
    })).toBeArray()
    expect(await database.query<{ id: string }>('Article', {
      fields: ['id'],
      where: "owner = '00000000-0000-4000-8000-000000000001'",
    })).toBeArray()
    expect(await database.query<{ id: string }>('Article', {
      fields: ['id'],
      where: 'owner = null',
    })).toBeArray()
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
    })).rejects.toThrow('references cannot be used in predicates or ordering')
  }, 120_000)

  freshIsolatedTest('matches string and structured predicates with two-valued null semantics', async database => {
    // Raw nullable DDL exercises NULL semantics while the canonical entity drives query validation.
    await database.sql`
      CREATE TABLE "QueryRow" ("id" uuid PRIMARY KEY,
        "active" boolean,
        "externalId" double precision,
        "rank" double precision,
        "score" double precision,
        "title" text )
    `
    await database.sql`
      INSERT INTO "QueryRow" ("id", "active", "externalId", "rank", "score", "title")
      VALUES (gen_random_uuid(),
        NULL,
        ${7},
        1,
        NULL,
        NULL),
        (gen_random_uuid(),
        TRUE,
        NULL,
        2,
        0,
        ''),
        (gen_random_uuid(),
        FALSE,
        NULL,
        3,
        5,
        '   '),
        (gen_random_uuid(),
        TRUE,
        NULL,
        4,
        10,
        'alpha'),
        (gen_random_uuid(),
        FALSE,
        ${7},
        5,
        NULL,
        'beta')
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

    await same('title $contains "alp"', {
      field: 'title',
      operator: Operator.Comparison.Contains,
      value: 'alp',
    })
    expect(await query('title $contains "alp"')).toEqual([{ rank: 4 }])
    await same('$not title $contains "alp"', {
      filters: [{
        field: 'title',
        operator: Operator.Comparison.Contains,
        value: 'alp',
      }],
      operator: Operator.Logical.Not,
    })
    expect(await query('$not title $contains "alp"'))
      .toEqual([{ rank: 1 }, { rank: 2 }, { rank: 3 }, { rank: 5 }])

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

    await same('externalId = 7', {
      field: 'externalId',
      operator: Operator.Comparison.Equal,
      value: 7,
    })
    expect(await query('externalId = 7')).toEqual([{ rank: 1 }, { rank: 5 }])
    await same('externalId $between [7, null]', {
      field: 'externalId',
      operator: Operator.Comparison.Between,
      values: [7, null],
    })
    expect(await query('externalId $between [7, null]'))
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
        CREATE TABLE "NumberRow" ("id" uuid PRIMARY KEY, "value" double precision NOT NULL)
      `
      await database.sql`
        INSERT INTO "NumberRow" ("id", "value")
        VALUES (gen_random_uuid(), ${1.5})
      `
      expect(await database.query<{ value: number }>('NumberRow', {
        fields: ['value'],
        limit: null,
      })).toEqual([{ value: 1.5 }])
    }, { fresh: true })

    const { server } = await useDatabaseFixture('rollback-success-check')
    expect(await server.db.sql<{ present: boolean }[]>`
      SELECT to_regclass(${`"${schema}"."NumberRow"`}) IS NOT NULL AS present
    `).toEqual([{ present: false }])
  }, 120_000)

  test('rolls back failed isolated tests', async () => {
    let schema = ''
    await expect(withIsolatedDatabase('rollback-failure', async database => {
      schema = database.schema
      await database.sql`
        CREATE TABLE "FailureProbe" ("id" uuid PRIMARY KEY)
      `
      throw new Error('forced isolated failure')
    }, { fresh: true })).rejects.toThrow('forced isolated failure')

    const { server } = await useDatabaseFixture('rollback-failure-check')
    expect(await server.db.sql<{ present: boolean }[]>`
      SELECT to_regclass(${`"${schema}"."FailureProbe"`}) IS NOT NULL AS present
    `).toEqual([{ present: false }])
  }, 120_000)

  test('runs concurrent isolated tests in independent schemas', async () => {
    const schemas = await Promise.all([
      withIsolatedDatabase('concurrent-a', async database => {
        await database.sql`
          CREATE TABLE "NumberRow" ("id" uuid PRIMARY KEY, "value" double precision NOT NULL)
        `
        await database.sql`
          INSERT INTO "NumberRow" ("id", "value")
          VALUES (gen_random_uuid(), ${1})
        `
        expect(await database.query<{ value: number }>('NumberRow', {
          fields: ['value'],
          limit: null,
        })).toEqual([{ value: 1 }])
        return database.schema
      }, { fresh: true }),
      withIsolatedDatabase('concurrent-b', async database => {
        await database.sql`
          CREATE TABLE "NumberRow" ("id" uuid PRIMARY KEY, "value" double precision NOT NULL)
        `
        await database.sql`
          INSERT INTO "NumberRow" ("id", "value")
          VALUES (gen_random_uuid(), ${2})
        `
        expect(await database.query<{ value: number }>('NumberRow', {
          fields: ['value'],
          limit: null,
        })).toEqual([{ value: 2 }])
        return database.schema
      }, { fresh: true }),
    ])

    expect(new Set(schemas).size).toBe(2)
    const { server } = await useDatabaseFixture('concurrent-check')
    expect(await server.db.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pg_catalog.pg_namespace
      WHERE nspname IN (${schemas[0]}, ${schemas[1]})
    `).toEqual([{ count: 0 }])
  }, 120_000)

  test('cleans committed durable schemas after failures', async () => {
    let schema = ''
    await expect(withDurableDatabase('durable-failure', async database => {
      schema = database.schema
      await database.tx(async sql => {
        await sql`
          CREATE TABLE "DurableFailure" ("id" uuid PRIMARY KEY)
        `
      })
      throw new Error('forced durable failure')
    })).rejects.toThrow('forced durable failure')

    const { server } = await useDatabaseFixture('durable-failure-check')
    expect(await server.db.sql<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schema} ) AS present
    `).toEqual([{ present: false }])
  }, 120_000)

  test('leaves no isolated database schemas behind', async () => {
    const { server } = await useDatabaseFixture('schema-leak-check')
    expect(await server.db.sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pg_catalog.pg_namespace
      WHERE nspname like 'basis_test_%'
    `).toEqual([{ count: 0 }])
  }, 30_000)

  test('rejects external PostgreSQL configuration', () => {
    expect(() => new Server().database({
      url: 'postgres://basis:basis@127.0.0.1:1/basis',
    } as never)).toThrow('unsupported database option')
  })

  test('uses a null capability when no database is configured', async () => {
    const server = start(new Server())

    try {
      await expect(server.db.connect()).rejects.toThrow('No database is configured for this server')
      await expect(server.db.tx(async sql => { void sql })).rejects.toThrow('No database is configured for this server')
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
