import { Logger } from 'basis/logger'
import { runAsync } from 'basis/utilities'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { DatabaseContext } from '../testing/DatabaseFixture'
import { withDatabase } from '../testing/DatabaseFixture'
import { accountDefinition, noteDefinition, numberRowDefinition, useDatabaseFixture } from '../testing/DatabaseFixture'
import { installSchema } from '../testing/Schema'
import { compileEntityQuery, queryEntity } from './Database'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'
import type { Filter } from './Predicate'

/*
 * Real PostgreSQL lifecycle. The suite owns Docker services through the
 * server capability; it never replaces the database boundary with a mock.
 */

const root = join(import.meta.dir, '..', '..', '..')
const silent = new Logger({ silent: true })

/**
 * Register an ordinary transaction-isolated database test.
 * @param name - Test name and fixture label.
 * @param callback - Test work.
 * @param timeout - Test timeout in milliseconds.
 */
function isolatedTest(
  name: string,
  callback: (database: DatabaseContext) => Promise<void>,
  timeout = 120_000,
): void {
  test(name, () => withDatabase(name, callback), timeout)
}

/**
 * Register a database test that needs a fresh schema, not the fixture schema.
 * @param name - Test name and fixture label.
 * @param callback - Test work.
 * @param timeout - Test timeout in milliseconds.
 */
function freshIsolatedTest(
  name: string,
  callback: (database: DatabaseContext) => Promise<void>,
  timeout = 120_000,
): void {
  test(name, () => withDatabase(name, callback, { fresh: true }), timeout)
}

/**
 * Register a cross-transaction database test in a durable unique schema.
 * @param name - Test name and fixture label.
 * @param callback - Test work.
 * @param timeout - Test timeout in milliseconds.
 */
function durableTest(
  name: string,
  callback: (database: DatabaseContext) => Promise<void>,
  timeout = 120_000,
): void {
  test(name, () => withDatabase(name, callback, { fresh: true }), timeout)
}

/**
 * Register a test that uses the canonical fixture schema.
 * @param name - Test name and fixture label.
 * @param callback - Test work.
 * @param timeout - Test timeout in milliseconds.
 */
function fixtureTest(
  name: string,
  callback: (database: DatabaseContext) => Promise<void>,
  timeout = 120_000,
): void {
  test(name, () => withDatabase(name, callback), timeout)
}

describe('Server database lifecycle', () => {
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
        CREATE TABLE tx_probe (
          value TEXT
        )
      `
    })

    const result = await database.tx(async sql => {
      await sql`
        INSERT INTO tx_probe
        VALUES
          ('committed')
      `
      return 'callback-result'
    })
    expect(result).toBe('callback-result')

    const count = async (): Promise<number | undefined> => (
      await database.tx(async sql => {
        const rows = await sql<{ count: number }[]>`
          SELECT COUNT(*)::int AS count
          FROM tx_probe
        `
        return rows[0]?.count
      })
    )
    expect(await count()).toBe(1)

    await expect(database.tx(async sql => {
      await sql`
        INSERT INTO tx_probe
        VALUES
          ('thrown')
      `
      throw new Error('rollback')
    })).rejects.toThrow('rollback')
    expect(await count()).toBe(1)

    await expect(database.tx(async sql => {
      await sql`
        INSERT INTO tx_probe
        VALUES
          ('failed')
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
      SELECT
        table_name AS "tableName",
        column_name AS "columnName",
        data_type AS "dataType",
        is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = CURRENT_SCHEMA()
        AND table_name = ${'Note'}
      ORDER BY ordinal_position
    `
    const accountColumns = await database.sql<{
      columnName: string,
      dataType: string,
      isNullable: string,
      tableName: string,
    }[]>`
      SELECT
        table_name AS "tableName",
        column_name AS "columnName",
        data_type AS "dataType",
        is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = CURRENT_SCHEMA()
        AND table_name = ${'Account'}
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
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = CURRENT_SCHEMA()
        AND tc.table_name IN (${'Note'}, ${'Account'})
      ORDER BY tc.table_name
    `
    expect(primaryKeys.map(row => row.tableName)).toEqual(['Account', 'Note'])

    const keptId = randomUUID()
    const accountId = '9223372036854775807'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${keptId}, ${'kept'}, ${'Note'}),
        (${accountId}, ${'Troy'}, ${'Account'})
    `
    await database.sql`
      INSERT INTO "Note" ("id", "title", "active", "score", "dueOn", "createdAt")
      VALUES
        (${keptId}, 'kept', TRUE, 1.5, '2026-01-02', NOW())
    `
    await database.sql`
      INSERT INTO "Account" ("id", "label")
      VALUES
        (${accountId}, ${'Troy'})
    `
    await installSchema(database.sql, entities)
    expect(await database.sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
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
  })

  fixtureTest('enforces Entity and User reference eligibility', async database => {
    const userId = randomUUID()
    const novelId = '123'
    await database.tx(async sql => {
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${userId}, ${'User'}, ${'SystemUser'}),
          (${novelId}, ${'Novel'}, ${'Novel'})
      `
      await sql`
        INSERT INTO "SystemUser" ("id", "label", "email", "permissions", "favorite.id")
        VALUES
          (${userId}, ${'User'}, ${'user@example.test'}, ${'admin'}, ${novelId})
      `
      await sql`
        INSERT INTO "Book" ("id", "title")
        VALUES
          (${novelId}, ${'Book'})
      `
      await sql`
        INSERT INTO "Novel" ("id", "genre")
        VALUES
          (${novelId}, ${'Genre'})
      `
      await sql`
        SET constraints ALL immediate
      `
    })

    expect(await database.tx(async sql => sql<{ email: string }[]>`
      SELECT "email"
      FROM "SystemUser"
      WHERE "id" = ${userId}
    `)).toEqual([{ email: 'user@example.test' }])

    const invalidId = randomUUID()
    const invalid = await database.tx(async sql => {
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${invalidId}, ${'Invalid user'}, ${'SystemUser'})
      `
      await sql`
        INSERT INTO "SystemUser" ("id", "label", "email", "permissions", "manager.id")
        VALUES
          (${invalidId}, ${'Invalid user'}, ${'invalid@example.test'}, ${'admin'}, ${randomUUID()})
      `
      await sql`
        SET constraints ALL immediate
      `
    }).catch((error: unknown) => error)
    expect((invalid as { errno?: string }).errno).toMatch(/^(23503|P0001)$/)
  })

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
        VALUES
          (${systemUserId}, ${'System User'}, ${'SystemUser'}),
          (${clientOwnerId}, ${'Client Owner'}, ${'Client'}),
          (${clientManagerId}, ${'Client Manager'}, ${'Client'}),
          (${'1001'}, ${'Article One'}, ${'Article'}),
          (${'1002'}, ${'Article Two'}, ${'Article'}),
          (${'1003'}, ${'Article Three'}, ${'Article'}),
          (${'1004'}, ${'Article Four'}, ${'Article'})
      `
      await sql`
        INSERT INTO "User" ("id", "email")
        VALUES
          (${systemUserId}, ${'system@example.test'}),
          (${clientOwnerId}, ${'owner@example.test'}),
          (${clientManagerId}, ${'manager@example.test'})
      `
      await sql`
        INSERT INTO "SystemUser" ("id", "permissions", "status", "manager.id")
        VALUES
          (${systemUserId}, ${'admin'}, ${'active'}, ${clientManagerId})
      `
      await sql`
        INSERT INTO "Client" ("id", "company", "status")
        VALUES
          (${clientOwnerId}, ${'Acme'}, ${'inactive'}),
          (${clientManagerId}, ${'Manager Co'}, ${'active'})
      `
      await sql`
        INSERT INTO "Article" ("id", "title", "owner.id", "favorite.id")
        VALUES
          (${'1001'}, ${'One'}, ${systemUserId}, ${systemUserId}),
          (${'1002'}, ${'Two'}, ${clientOwnerId}, ${clientOwnerId}),
          (${'1003'}, ${'Three'}, ${null}, ${'1001'}),
          (${'1004'}, ${'Four'}, ${null}, ${null})
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
  })

  durableTest('blocks partial fresh-schema initialization inside db.tx', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        { fields: [], name: 'Good' },
        { fields: [], name: 'Broken' },
      ],
    }))
    await database.tx(async sql => sql`
      CREATE TABLE "Broken" (
        "marker" TEXT
      )
    `)
    const failure = await database.tx(async sql => installSchema(sql, entities)).catch((error: unknown) => error)
    expect(failure).toMatchObject({ message: expect.stringContaining('Migration plan has blocking drift') })
    expect(await database.tx(async sql => sql<{ entity: boolean, good: boolean }[]>`
      SELECT to_regclass('"Entity"') IS NOT NULL AS entity,
        to_regclass('"Good"') IS NOT NULL AS good
    `)).toEqual([{ entity: false, good: false }])
  })

  isolatedTest('creates and indexes the universal identity root', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({ entities: [noteDefinition] }))
    await database.use(entities)
    await installSchema(database.sql, entities)

    expect(await database.sql<{ columnName: string, dataType: string, isNullable: string }[]>`
      SELECT column_name AS "columnName", data_type AS "dataType", is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = CURRENT_SCHEMA()
        AND table_name = 'Entity'
      ORDER BY ordinal_position
    `).toEqual([
      { columnName: 'id', dataType: 'text', isNullable: 'NO' },
      { columnName: 'name', dataType: 'text', isNullable: 'NO' },
      { columnName: 'entity', dataType: 'text', isNullable: 'NO' },
      { columnName: 'lastUpdatedBy.id', dataType: 'text', isNullable: 'YES' },
      { columnName: 'lastUpdatedAt', dataType: 'timestamp with time zone', isNullable: 'YES' },
    ])
    expect(await database.sql<{ indexName: string }[]>`
      SELECT indexname AS "indexName"
      FROM pg_indexes
      WHERE schemaname = CURRENT_SCHEMA()
        AND tablename = 'Entity'
        AND indexname LIKE 'Entity_name%'
      ORDER BY indexname
    `).toEqual([
      { indexName: 'Entity_name_id_idx' },
      { indexName: 'Entity_name_trgm_idx' },
    ])
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'UUID', 'Note'),
        ('0', 'Zero', 'Note'),
        ('-9223372036854775808', 'Minimum', 'Note'),
        ('9223372036854775807', 'Maximum', 'Note')
    `
    expect(await database.captureError(async db => {
      await db.sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          ('42', 'Abstract', 'User')
      `
    })).toMatchObject({ errno: '23514' })
  })

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
      VALUES
        (${id}, 'Actor', 'Actor')
    `
    await database.sql`
      INSERT INTO "Actor" ("id", "label")
      VALUES
        (${id}, 'Selected')
    `

    expect(await database.query<{ id: string, label: string }>('Actor', {
      fields: ['id', 'label'],
      where: { id },
    })).toEqual([{ id, label: 'Selected' }])
    await expect(database.query('Note', { fields: ['id'] }))
      .rejects.toThrow('Unknown entity or relationship "Note"')
  })

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
          }, { field: 'campaigns', target: 'Campaign', type: 'Collection', via: 'Membership[user = @].campaign' }],
          name: 'User',
        }, {
          fields: [{
            field: 'members',
            target: 'User',
            type: 'Collection',
            via: 'Membership[campaign = @].user',
          }],
          name: 'Campaign',
        },
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
          { field: 'user', target: 'User' },
          { field: 'campaign', target: 'Campaign' },
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
      SELECT
        column_name AS "columnName",
        data_type AS "dataType",
        is_nullable AS "isNullable",
        udt_name AS "udtName"
      FROM information_schema.columns
      WHERE table_schema = CURRENT_SCHEMA()
        AND table_name = 'Article'
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
      WHERE table_schema = CURRENT_SCHEMA()
        AND table_name = 'Membership'
      ORDER BY ordinal_position
    `).toEqual([
      { columnName: 'user.id', dataType: 'text', isNullable: 'NO' },
      { columnName: 'campaign.id', dataType: 'text', isNullable: 'NO' },
      { columnName: 'role', dataType: 'text', isNullable: 'NO' },
      { columnName: 'favorites', dataType: 'text', isNullable: 'NO' },
    ])
    expect(await database.sql<{ definition: string }[]>`
      SELECT PG_GET_CONSTRAINTDEF(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = '"Membership"'::regclass
        AND contype = 'p'
    `).toEqual([{ definition: 'PRIMARY KEY ("user.id", "campaign.id")' }])
    expect(await database.sql<{ definition: string }[]>`
      SELECT PG_GET_CONSTRAINTDEF(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = '"Membership"'::regclass
        AND contype = 'f'
      ORDER BY conname
    `).toEqual([
      { definition: 'FOREIGN KEY ("campaign.id") REFERENCES "Campaign"(id) DEFERRABLE' },
      { definition: 'FOREIGN KEY ("user.id") REFERENCES "User"(id) DEFERRABLE' },
    ])
    expect((await database.sql<{ indexName: string }[]>`
      SELECT indexname AS "indexName"
      FROM pg_indexes
      WHERE schemaname = CURRENT_SCHEMA()
        AND tablename = 'Membership'
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
      VALUES
        (${ada}, 'Ada', 'User'),
        (${grace}, 'Grace', 'User'),
        (${linus}, 'Linus', 'User'),
        (${campaign}, 'Example Campaign', 'Campaign'),
        (${secondCampaign}, 'Second Campaign', 'Campaign'),
        (${articleOne}, 'Article One', 'Article'),
        (${articleTwo}, 'Article Two', 'Article')
    `
    await database.sql`
      INSERT INTO "User" ("id")
      VALUES
        (${ada}),
        (${grace}),
        (${linus})
    `
    await database.sql`
      INSERT INTO "Campaign" ("id")
      VALUES
        (${campaign}),
        (${secondCampaign})
    `
    await database.sql`
      INSERT INTO "Article" ("id", "author.id", "tags", "payload")
      VALUES
        (${articleOne}, ${ada}, ARRAY ['one', 'two'], '{"kind":"note"}'::jsonb),
        (${articleTwo}, ${ada}, ARRAY ['three'], '{"kind":"memo"}'::jsonb)
    `
    await database.sql`
      INSERT INTO "Membership" ("user.id", "campaign.id", "role", "favorites")
      VALUES
        (${ada}, ${campaign}, 'GM', 'dice'),
        (${grace}, ${campaign}, 'Player', 'cards')
    `
    expect(await database.sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "Entity"
      WHERE "entity" = 'Membership'
    `).toEqual([{ count: 0 }])
    expect(await database.captureError(async db => {
      await db.sql`
        INSERT INTO "Membership" ("user.id", "campaign.id", "role", "favorites")
        VALUES
          (${ada}, ${campaign}, 'Duplicate', 'none')
      `
    })).toMatchObject({ errno: '23505' })
    expect(await database.captureError(async db => {
      await db.sql`
        INSERT INTO "Membership" ("user.id", "campaign.id", "role", "favorites")
        VALUES
          (${randomUUID()}, ${campaign}, 'Dangling', 'none')
      `
    })).toMatchObject({ errno: '23503' })

    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'User', {
      fields: ['id', 'name', 'articles'],
      where: { id: ada },
    })).toEqual([{
      articles: {
        $matched: 2,
        $total: 2,
        items: [
          { entity: 'Article', id: articleOne, name: 'Article One' },
          { entity: 'Article', id: articleTwo, name: 'Article Two' },
        ],
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

    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'Campaign', {
      fields: ['id', 'members{$limit:2}'],
      where: { id: campaign },
    })).toEqual([{
      id: campaign,
      members: {
        $matched: 2,
        $total: 2,
        items: [
          { entity: 'User', id: ada, name: 'Ada' },
          { entity: 'User', id: grace, name: 'Grace' },
        ],
      },
    }])
    const projectedMembers = await queryEntity<{
      id: string,
      members: { $matched: number, $total: number, items: Record<string, unknown>[] },
      name: string,
    }>(database.sql, entities, 'Campaign', {
      fields: ['id', 'name', 'members', 'members.name', 'members.role'],
      where: { id: campaign },
    })
    expect(projectedMembers).toHaveLength(1)
    expect(projectedMembers[0]?.members.items).toHaveLength(2)
    expect(projectedMembers[0]?.members.$total).toBe(2)
    expect(projectedMembers[0]?.members.items).toEqual(expect.arrayContaining([
      { entity: 'User', id: ada, name: 'Ada', role: 'GM' },
      { entity: 'User', id: grace, name: 'Grace', role: 'Player' },
    ]))
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'User', {
      fields: ['id', 'campaigns', 'campaigns.role'],
      orderBy: 'id',
      where: { id: ada },
    })).toEqual([{
      campaigns: {
        $matched: 1,
        $total: 1,
        items: [{
          entity: 'Campaign',
          id: campaign,
          name: 'Example Campaign',
          role: 'GM',
        }],
      },
      id: ada,
    }])
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'User', {
      fields: ['id', 'campaigns{$limit:1,$offset:1}'],
      where: { id: linus },
    })).toEqual([{
      campaigns: { $matched: 0, $total: 0, items: [] },
      id: linus,
    }])

    await database.sql`
      INSERT INTO "Membership" ("user.id", "campaign.id", "role", "favorites")
      VALUES
        (${linus}, ${campaign}, 'Player', 'cards')
    `
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'Campaign', {
      fields: ['id', 'members{$limit:1,$offset:1}'],
      where: { id: campaign },
    })).toEqual([{
      id: campaign,
      members: {
        $matched: 3,
        $total: 3,
        items: [{ entity: 'User', id: grace, name: 'Grace' }],
      },
    }])
    const multipleRoots = await queryEntity<Record<string, unknown>>(database.sql, entities, 'User', {
      fields: ['id', 'campaigns{$limit:1}'],
      orderBy: 'id',
    })
    expect(multipleRoots.map(row => row.id)).toEqual([ada, grace, linus])
    expect(multipleRoots).toHaveLength(3)
  })

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
            { field: 'campaigns', target: 'Campaign', type: 'Collection', via: 'Membership[user = @].campaign' },
          ],
          name: 'User',
        },
        {
          extends: 'User',
          fields: [{ field: 'permissions', type: 'String' }],
          name: 'SystemUser',
        }, {
          fields: [{
            field: 'members',
            target: 'User',
            type: 'Collection',
            via: 'Membership[campaign = @].user',
          }],
          name: 'Campaign',
        },
        {
          fields: [{ field: 'author', inverse: 'articles', target: 'User', type: 'Entity' }],
          name: 'Article',
        },
      ],
      relationships: [{
        between: [
          { field: 'user', target: 'User' },
          { field: 'campaign', target: 'Campaign' },
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
      VALUES
        (${userId}, 'Ada', 'SystemUser'),
        (${campaignId}, 'Example Campaign', 'Campaign'),
        (${articleId}, 'Article One', 'Article')
    `
    await database.sql`
      INSERT INTO "User" ("id")
      VALUES
        (${userId})
    `
    await database.sql`
      INSERT INTO "SystemUser" ("id", "permissions")
      VALUES
        (${userId}, 'admin')
    `
    await database.sql`
      INSERT INTO "Campaign" ("id")
      VALUES
        (${campaignId})
    `
    await database.sql`
      INSERT INTO "Article" ("id", "author.id")
      VALUES
        (${articleId}, ${userId})
    `
    await database.sql`
      INSERT INTO "Membership" ("user.id", "campaign.id", "role", "favorites")
      VALUES
        (${userId}, ${campaignId}, 'GM', 'dice')
    `
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'SystemUser', {
      fields: ['id', 'campaigns', 'campaigns.role', 'articles'],
      where: { id: userId },
    })).toEqual([{
      articles: {
        $matched: 1,
        $total: 1,
        items: [{ entity: 'Article', id: articleId, name: 'Article One' }],
      },
      campaigns: {
        $matched: 1,
        $total: 1,
        items: [{
          entity: 'Campaign',
          id: campaignId,
          name: 'Example Campaign',
          role: 'GM',
        }],
      },
      id: userId,
    }])
  })

  isolatedTest('projects nested collection paths and relationship properties', async database => {
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
          ],
          name: 'User',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'label', type: 'String' },
            { field: 'owner', inverse: 'pets', target: 'User', type: 'Entity' },
            {
              cardinality: 'Many',
              field: 'toys',
              inverse: 'pet',
              target: 'Toy',
              type: 'Inverse',
            },
          ],
          name: 'Pet',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'label', type: 'String' },
            { field: 'pet', inverse: 'toys', target: 'Pet', type: 'Entity' },
          ],
          name: 'Toy',
        },
      ],
    }))
    await database.use(entities)
    const user = '00000000-0000-4000-8000-000000000101'
    const pet = '00000000-0000-4000-8000-000000000102'
    const toy = '00000000-0000-4000-8000-000000000103'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${user}, 'Ada', 'User'),
        (${pet}, 'Rex', 'Pet'),
        (${toy}, 'Ball', 'Toy')
    `
    await database.sql`
      INSERT INTO "User" ("id")
      VALUES
        (${user})
    `
    await database.sql`
      INSERT INTO "Pet" ("id", "owner.id", "label")
      VALUES
        (${pet}, ${user}, 'Dog')
    `
    await database.sql`
      INSERT INTO "Toy" ("id", "pet.id", "label")
      VALUES
        (${toy}, ${pet}, 'Red')
    `
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'User', {
      fields: ['id', 'pets', 'pets.label', 'pets.toys', 'pets.toys.label'],
      where: { id: user },
    })).toEqual([{
      id: user,
      pets: {
        $matched: 1,
        $total: 1,
        items: [{
          entity: 'Pet',
          id: pet,
          label: 'Dog',
          name: 'Rex',
          toys: {
            $matched: 1,
            $total: 1,
            items: [{
              entity: 'Toy',
              id: toy,
              label: 'Red',
              name: 'Ball',
            }],
          },
        }],
      },
    }])
  })

  isolatedTest('caps projected collections, reports totals and applies collection filters', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [{
          field: 'id',
          format: 'UUID',
        },
        {
          field: 'campaigns',
          target: 'Campaign',
          type: 'Collection',
          via: 'Membership[user = @].campaign',
        }],
        name: 'User',
      }, {
        fields: [{
          field: 'members',
          target: 'User',
          type: 'Collection',
          via: 'Membership[campaign = @].user',
        }],
        name: 'Campaign',
      }],
      relationships: [{
        between: [
          { field: 'user', target: 'User' },
          { field: 'campaign', target: 'Campaign' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'Membership',
      }],
    }))
    await database.use(entities)
    const campaign = '00000000-0000-4000-8000-000000000201'
    const users = [
      ['00000000-0000-4000-8000-000000000202', 'Ada'],
      ['00000000-0000-4000-8000-000000000203', 'Bob'],
      ['00000000-0000-4000-8000-000000000204', 'Cara'],
      ['00000000-0000-4000-8000-000000000205', 'Dan'],
      ['00000000-0000-4000-8000-000000000206', 'Eve'],
    ] as const
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${campaign}, 'Campaign', 'Campaign')
    `
    await database.sql`
      INSERT INTO "Campaign" ("id")
      VALUES
        (${campaign})
    `
    for (const [id, name] of users) {
      await database.sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${id}, ${name}, 'User')
      `
      await database.sql`
        INSERT INTO "User" ("id")
        VALUES
          (${id})
      `
      await database.sql`
        INSERT INTO "Membership" ("user.id", "campaign.id", "role")
        VALUES
          (${id}, ${campaign}, 'Player')
      `
    }

    const query = (fields: string[]) => queryEntity<{
      id: string,
      members: { $matched: number, $total: number, items: { name: string }[] },
    }>(database.sql, entities, 'Campaign', { fields, where: { id: campaign } })

    const defaults = await query(['id', 'members', 'members.name'])
    expect(defaults[0]?.members.items).toHaveLength(3)
    expect(defaults[0]?.members.$total).toBe(5)

    const expanded = await query(['id', 'members{$limit:null}', 'members.name'])
    expect(expanded[0]?.members.items).toHaveLength(5)
    expect(expanded[0]?.members.$total).toBe(5)

    const capped = await query(['id', 'members{$limit:2}', 'members.name'])
    expect(capped[0]?.members.items).toHaveLength(2)
    expect(capped[0]?.members.$total).toBe(5)

    const filtered = await query([
      'id',
      "members[name != 'Ada']",
      'members.name',
    ])
    expect(filtered[0]?.members.items).toHaveLength(3)
    expect(filtered[0]?.members.$matched).toBe(4)
    expect(filtered[0]?.members.$total).toBe(5)
    expect(filtered[0]?.members.items.map(member => member.name)).not.toContain('Ada')

    const filteredExpanded = await query([
      'id',
      "members[name != 'Ada']{$limit:null}",
      'members.name',
    ])
    expect(filteredExpanded[0]?.members.items).toHaveLength(4)
    expect(filteredExpanded[0]?.members.$matched).toBe(4)
    expect(filteredExpanded[0]?.members.$total).toBe(5)

    const paged = await query([
      'id',
      'members{$limit:2,$offset:1,$orderBy:-name}',
      'members.name',
    ])
    expect(paged[0]?.members.items.map(member => member.name)).toEqual(['Dan', 'Cara'])
    expect(paged[0]?.members.$total).toBe(5)
  })

  isolatedTest('enforces the complete collection projection contract', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'active', type: 'Boolean' },
            { field: 'partner', target: 'User', type: 'Entity' },
            { field: 'campaigns', target: 'Campaign', type: 'Collection', via: 'Membership[user = @].campaign' },
          ],
          name: 'User',
        }, {
          fields: [{
            field: 'members',
            target: 'User',
            type: 'Collection',
            via: 'Membership[campaign = @].user',
          }],
          name: 'Campaign',
        },
      ],
      relationships: [{
        between: [
          { field: 'user', target: 'User' },
          { field: 'campaign', target: 'Campaign' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'Membership',
      }],
    }))
    await database.use(entities)

    expect(() => compileEntityQuery(entities, 'Campaign', {
      fields: ['id', 'members{$limit:1,$limit:2}'],
    })).toThrow('repeated')
    expect(() => compileEntityQuery(entities, 'Campaign', {
      fields: ['id', 'members{$offset:1,$offset:2}'],
    })).toThrow('repeated')
    expect(() => compileEntityQuery(entities, 'Campaign', {
      fields: ['id', 'members{$orderBy:name,$orderBy:-name}'],
    })).toThrow('repeated')

    const idFor = (index: number): string => (
      `00000000-0000-4000-8000-${String(1000 + index).padStart(12, '0')}`
    )
    const campaign = '00000000-0000-4000-8000-000000000901'
    const tiedCampaign = '00000000-0000-4000-8000-000000000902'
    const emptyCampaign = '00000000-0000-4000-8000-000000000903'
    const members = Array.from({ length: 30 }, (_, index) => ({
      active: index < 12,
      id: idFor(index),
      name: `M${String(index).padStart(2, '0')}`,
      role: index < 12 ? 'GM' : 'Player',
    }))
    const tied = Array.from({ length: 5 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(2000 + index).padStart(12, '0')}`,
      name: 'Tie',
      role: 'Player',
    }))
    for (const [id, name] of [
      [campaign, 'Contract Campaign'],
      [tiedCampaign, 'Tied Campaign'],
      [emptyCampaign, 'Empty Campaign'],
    ] as const) {
      await database.sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${id}, ${name}, 'Campaign')
      `
      await database.sql`
        INSERT INTO "Campaign" ("id")
        VALUES
          (${id})
      `
    }
    for (const member of members) {
      await database.sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${member.id}, ${member.name}, 'User')
      `
      await database.sql`
        INSERT INTO "User" ("id", "active")
        VALUES
          (${member.id}, ${member.active})
      `
      await database.sql`
        INSERT INTO "Membership" ("user.id", "campaign.id", "role")
        VALUES
          (${member.id}, ${campaign}, ${member.role})
      `
    }
    for (const member of tied) {
      await database.sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${member.id}, ${member.name}, 'User')
      `
      await database.sql`
        INSERT INTO "User" ("id", "active")
        VALUES
          (${member.id}, TRUE)
      `
      await database.sql`
        INSERT INTO "Membership" ("user.id", "campaign.id", "role")
        VALUES
          (${member.id}, ${tiedCampaign}, ${member.role})
      `
    }

    await database.sql`
      UPDATE "User"
      SET "partner.id" = ${members[1]?.id}
      WHERE "id" = ${members[0]?.id}
    `
    await database.sql`
      UPDATE "User"
      SET "partner.id" = ${members[20]?.id}
      WHERE "id" = ${members[2]?.id}
    `

    interface Member { id: string, name: string, role: string }
    interface Envelope { $matched: number, $total: number, items: Member[] }
    const query = (campaignId: string, fields: string[]) => queryEntity<{
      id: string,
      members: Envelope,
    }>(database.sql, entities, 'Campaign', { fields, where: { id: campaignId } })

    const flattened = await query(campaign, [
      'id',
      "members[role = 'GM']{$limit:null}",
      'members.name',
      'members.role',
    ])
    expect(flattened[0]?.members.$matched).toBe(12)
    expect(flattened[0]?.members.$total).toBe(30)
    expect(flattened[0]?.members.items).toHaveLength(12)
    expect(flattened[0]?.members.items.every(member => member.role === 'GM')).toBe(true)

    const descending = await query(campaign, [
      'id',
      'members{$orderBy:-name,$limit:null}',
      'members.name',
    ])
    expect(descending[0]?.members.items.map(member => member.name)).toEqual(
      Array.from({ length: 30 }, (_, index) => `M${String(29 - index).padStart(2, '0')}`),
    )

    const pages = await Promise.all([0, 2, 4].map(async offset => (
      await query(tiedCampaign, [
        'id',
        `members{$orderBy:name,$limit:2,$offset:${offset}}`,
        'members.name',
      ])
    )))
    const paged = pages.flatMap(page => page[0]?.members.items ?? [])
    expect(paged).toHaveLength(5)
    expect(new Set(paged.map(member => member.id)).size).toBe(5)
    expect(paged.map(member => member.id)).toEqual([...tied.map(member => member.id)].sort())

    const filtered = await query(campaign, [
      'id',
      'members[active = true]{$orderBy:name,$offset:5,$limit:4}',
      'members.name',
    ])
    expect(filtered[0]?.members.$matched).toBe(12)
    expect(filtered[0]?.members.$total).toBe(30)
    expect(filtered[0]?.members.items.map(member => member.name)).toEqual([
      'M05',
      'M06',
      'M07',
      'M08',
    ])

    const roots = (where: string, fields: string[] = ['id']) => queryEntity<{ id: string }>(
      database.sql,
      entities,
      'Campaign',
      { fields, orderBy: 'id', where },
    )
    expect(await roots('members.$total >= 30')).toEqual([{ id: campaign }])
    expect(await roots('members.$total = 0')).toEqual([{ id: emptyCampaign }])
    expect(await roots("members[role = 'GM'].$matched = 12")).toEqual([{ id: campaign }])
    expect(await roots("members[role = 'GM'].$total = 30")).toEqual([{ id: campaign }])
    expect(await roots("members[role = 'GM'].$matched = 0")).toEqual([
      { id: tiedCampaign },
      { id: emptyCampaign },
    ])
    expect(await roots("members[role = 'GM'].$total = 0")).toEqual([{ id: emptyCampaign }])
    expect((await roots('members.$matched = members.$total', [
      'id',
      'members{$limit:1}',
      'members.name',
    ])).map(row => row.id)).toEqual([campaign, tiedCampaign, emptyCampaign])
    expect((await roots('members.$matched = members.$total')).map(row => row.id))
      .toEqual([campaign, tiedCampaign, emptyCampaign])
    expect(await roots('members[partner.active = true].$matched = 1'))
      .toEqual([{ id: campaign }])
    expect(await roots('members[partner.active = true].$matched = 0')).toEqual([
      { id: tiedCampaign },
      { id: emptyCampaign },
    ])
  })

  isolatedTest('does not project collection ordering fields unless requested', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'email', type: 'String' },
            { field: 'campaigns', target: 'Campaign', type: 'Collection', via: 'Membership[user = @].campaign' },
          ],
          name: 'User',
        }, {
          fields: [{
            field: 'members',
            target: 'User',
            type: 'Collection',
            via: 'Membership[campaign = @].user',
          }],
          name: 'Campaign',
        },
      ],
      relationships: [{
        between: [
          { field: 'user', target: 'User' },
          { field: 'campaign', target: 'Campaign' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'Membership',
      }],
    }))
    await database.use(entities)
    const campaign = '00000000-0000-4000-8000-000000000a01'
    const members = [
      ['00000000-0000-4000-8000-000000000a11', 'c@example.com'],
      ['00000000-0000-4000-8000-000000000a12', 'a@example.com'],
      ['00000000-0000-4000-8000-000000000a13', 'e@example.com'],
      ['00000000-0000-4000-8000-000000000a14', 'b@example.com'],
      ['00000000-0000-4000-8000-000000000a15', 'd@example.com'],
    ] as const
    const expected = [...members].sort((left, right) => left[1].localeCompare(right[1]))
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${campaign}, 'Ordering Campaign', 'Campaign')
    `
    await database.sql`
      INSERT INTO "Campaign" ("id")
      VALUES
        (${campaign})
    `
    for (const [id, email] of members) {
      await database.sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${id}, ${email}, 'User')
      `
      await database.sql`
        INSERT INTO "User" ("id", "email")
        VALUES
          (${id}, ${email})
      `
      await database.sql`
        INSERT INTO "Membership" ("user.id", "campaign.id", "role")
        VALUES
          (${id}, ${campaign}, 'GM')
      `
    }

    interface Item { email?: string, id: string, role: string }
    interface Envelope { $matched: number, $total: number, items: Item[] }
    const query = (fields: string[]) => queryEntity<{
      id: string,
      members: Envelope,
    }>(database.sql, entities, 'Campaign', { fields, where: { id: campaign } })

    const hidden = await query(['id', 'members{$orderBy:email,$limit:null}', 'members.role'])
    expect(hidden[0]?.members.items.map(item => item.id)).toEqual(expected.map(([id]) => id))
    expect(hidden[0]?.members.items.every(item => !('email' in item))).toBe(true)
    expect(hidden[0]?.members.items.every(item => item.role === 'GM')).toBe(true)

    const projected = await query([
      'id',
      'members{$orderBy:email,$limit:null}',
      'members.email',
      'members.role',
    ])
    expect(projected[0]?.members.items.map(item => item.email)).toEqual(expected.map(([, email]) => email))
    expect(projected[0]?.members.items.map(item => item.id)).toEqual(expected.map(([id]) => id))

    const pages = async (includeEmail: boolean): Promise<Item[]> => {
      const fields = [
        'members{$orderBy:email,$limit:2,$offset:0}',
        'members.role',
        ...(includeEmail ? ['members.email'] : []),
      ]
      const offsets = [0, 2, 4]
      const results = await Promise.all(offsets.map(async offset => (
        await query(fields.map(field => field.replace('$offset:0', `$offset:${offset}`)))
      )))
      return results.flatMap(result => result[0]?.members.items ?? [])
    }
    for (const includeEmail of [false, true]) {
      const paged = await pages(includeEmail)
      expect(paged.map(item => item.id)).toEqual(expected.map(([id]) => id))
      expect(new Set(paged.map(item => item.id)).size).toBe(members.length)
      expect(paged.every(item => 'email' in item === includeEmail)).toBe(true)
    }
  })

  isolatedTest('projects explicit relationship-record collections', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'members', target: 'User', type: 'Collection', via: 'memberships.user' },
            {
              field: 'memberships',
              target: 'DeckMembership',
              type: 'Collection',
              via: 'DeckMembership[deck = @]',
            },
          ],
          name: 'Deck',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'decks', target: 'Deck', type: 'Collection', via: 'deckMemberships.deck' },
            {
              field: 'deckMemberships',
              target: 'DeckMembership',
              type: 'Collection',
              via: 'DeckMembership[user = @]',
            },
          ],
          name: 'User',
        },
      ],
      relationships: [{
        between: [
          { field: 'deck', target: 'Deck' },
          { field: 'user', target: 'User' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'DeckMembership',
      }],
    }))
    await database.use(entities)
    const deckA = '00000000-0000-4000-8000-000000000b01'
    const deckB = '00000000-0000-4000-8000-000000000b02'
    const ada = '00000000-0000-4000-8000-000000000b11'
    const grace = '00000000-0000-4000-8000-000000000b12'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${deckA}, 'Deck A', 'Deck'),
        (${deckB}, 'Deck B', 'Deck'),
        (${ada}, 'Ada', 'User'),
        (${grace}, 'Grace', 'User')
    `
    await database.sql`
      INSERT INTO "Deck" ("id")
      VALUES
        (${deckA}),
        (${deckB})
    `
    await database.sql`
      INSERT INTO "User" ("id")
      VALUES
        (${ada}),
        (${grace})
    `
    await database.sql`
      INSERT INTO "DeckMembership" ("deck.id", "user.id", "role")
      VALUES
        (${deckA}, ${ada}, 'Owner'),
        (${deckA}, ${grace}, 'Viewer')
    `
    const records = await queryEntity<{
      id: string,
      memberships: { $matched: number, $total: number, items: Record<string, unknown>[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'memberships'],
      orderBy: 'id',
    })
    expect(records).toEqual([
      {
        id: deckA,
        memberships: {
          $matched: 2,
          $total: 2,
          items: expect.arrayContaining([
            expect.objectContaining({ role: 'Owner', user: expect.objectContaining({ id: ada }) }),
            expect.objectContaining({ role: 'Viewer', user: expect.objectContaining({ id: grace }) }),
          ]),
        },
      },
      {
        id: deckB,
        memberships: { $matched: 0, $total: 0, items: [] },
      },
    ])
    const owners = await queryEntity<{
      id: string,
      memberships: { $matched: number, $total: number, items: Record<string, unknown>[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', "memberships[role = 'Owner'].user"],
      orderBy: 'id',
      where: { id: deckA },
    })
    expect(owners[0]?.memberships.$matched).toBe(1)
    expect(owners[0]?.memberships.$total).toBe(2)
    expect(owners[0]?.memberships.items).toEqual([
      expect.objectContaining({
        role: 'Owner',
        user: expect.objectContaining({ id: ada }),
      }),
    ])
    const sameRecord = await queryEntity<{
      memberships: { $matched: number, $total: number, items: Record<string, unknown>[] },
    }>(database.sql, entities, 'Deck', {
      fields: [`memberships[role = 'Owner' $and user = '${ada}']`],
      where: { id: deckA },
    })
    expect(sameRecord[0]?.memberships.$matched).toBe(1)
    const differentRecord = await queryEntity<{
      memberships: { $matched: number },
    }>(database.sql, entities, 'Deck', {
      fields: [`memberships[role = 'Owner' $and user = '${grace}']`],
      where: { id: deckA },
    })
    expect(differentRecord[0]?.memberships.$matched).toBe(0)
    const rootRecords = await queryEntity<Record<string, unknown>>(
      database.sql,
      entities,
      'DeckMembership',
      {
        fields: ['deck', 'user', 'role'],
        orderBy: 'role',
        where: { role: 'Owner' },
      },
    )
    expect(rootRecords).toEqual([
      expect.objectContaining({
        deck: expect.objectContaining({ id: deckA }),
        role: 'Owner',
        user: expect.objectContaining({ id: ada }),
      }),
    ])
    expect(await database.create('DeckMembership', {
      deck: deckB,
      role: 'Editor',
      user: ada,
    })).toMatchObject({ created: 1, record: { role: 'Editor' } })
    expect(await database.edit('DeckMembership', { deck: deckB, user: ada }, {
      role: 'Viewer',
    })).toMatchObject({ edited: 1, record: { role: 'Viewer' } })
    expect(await database.upsert('DeckMembership', { deck: deckB, user: grace }, {
      deck: deckB,
      role: 'Owner',
      user: grace,
    })).toMatchObject({ created: 1, edited: 0, record: { role: 'Owner' } })
    expect(await database.delete('DeckMembership', { deck: deckB, user: ada }))
      .toEqual({ deleted: 1 })
    expect(entities.ddl.join('\n')).toContain('create table "DeckMembership"')
    expect(entities.ddl.join('\n')).not.toContain('create table "memberships"')
  })

  isolatedTest('supports three-way relationship-record collections', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            {
              field: 'entries',
              target: 'DeckCardPrinting',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @]',
            },
            { field: 'cards', target: 'Card', type: 'Collection', via: 'entries.card' },
            { field: 'printings', target: 'Printing', type: 'Collection', via: 'entries.printing' },
          ],
          name: 'Deck',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            {
              field: 'decks',
              target: 'Deck',
              type: 'Collection',
              via: 'DeckCardPrinting[card = @].deck',
            },
          ],
          name: 'Card',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            {
              field: 'decks',
              target: 'Deck',
              type: 'Collection',
              via: 'DeckCardPrinting[printing = @].deck',
            },
          ],
          name: 'Printing',
        },
      ],
      relationships: [{
        between: [
          { field: 'deck', target: 'Deck' },
          { field: 'card', target: 'Card' },
          { field: 'printing', target: 'Printing' },
        ],
        fields: [{ field: 'quantity', type: 'Number' }],
        name: 'DeckCardPrinting',
      }],
    }))
    await database.use(entities)
    const deckA = '00000000-0000-4000-8000-000000000c01'
    const deckB = '00000000-0000-4000-8000-000000000c02'
    const cardA = '00000000-0000-4000-8000-000000000c11'
    const cardB = '00000000-0000-4000-8000-000000000c12'
    const printingA = '00000000-0000-4000-8000-000000000c21'
    const printingB = '00000000-0000-4000-8000-000000000c22'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${deckA}, 'Deck A', 'Deck'),
        (${deckB}, 'Deck B', 'Deck'),
        (${cardA}, 'Card A', 'Card'),
        (${cardB}, 'Card B', 'Card'),
        (${printingA}, 'Printing A', 'Printing'),
        (${printingB}, 'Printing B', 'Printing')
    `
    await database.sql`
      INSERT INTO "Deck" ("id")
      VALUES
        (${deckA}),
        (${deckB})
    `
    await database.sql`
      INSERT INTO "Card" ("id")
      VALUES
        (${cardA}),
        (${cardB})
    `
    await database.sql`
      INSERT INTO "Printing" ("id")
      VALUES
        (${printingA}),
        (${printingB})
    `
    await database.sql`
      INSERT INTO "DeckCardPrinting" ("deck.id", "card.id", "printing.id", "quantity")
      VALUES
        (${deckA}, ${cardA}, ${printingA}, 1),
        (${deckA}, ${cardB}, ${printingB}, 3)
    `
    const records = await queryEntity<{
      entries: { $matched: number, $total: number, items: Record<string, unknown>[] },
      id: string,
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'entries', 'entries.card', 'entries.printing'],
      orderBy: 'id',
    })
    expect(records[0]?.entries.$matched).toBe(2)
    expect(records[0]?.entries.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        card: expect.objectContaining({ id: cardA }),
        printing: expect.objectContaining({ id: printingA }),
        quantity: 1,
      }),
      expect.objectContaining({
        card: expect.objectContaining({ id: cardB }),
        printing: expect.objectContaining({ id: printingB }),
        quantity: 3,
      }),
    ]))
    expect(records[1]?.entries).toEqual({ $matched: 0, $total: 0, items: [] })
    expect(entities.entity('Card')?.collections.map(collection => collection.name)).toEqual(['decks'])
    expect(entities.entity('Printing')?.collections.map(collection => collection.name))
      .toEqual(['decks'])
    const projected = await queryEntity<{
      cards: { $matched: number, items: { id: string }[] },
      printings: { $matched: number, items: { id: string }[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'cards', 'printings'],
      where: { id: deckA },
    })
    expect(projected[0]?.cards).toMatchObject({ $matched: 2 })
    expect(projected[0]?.cards.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: cardA }),
      expect.objectContaining({ id: cardB }),
    ]))
    expect(projected[0]?.printings).toMatchObject({ $matched: 2 })
    expect(projected[0]?.printings.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: printingA }),
      expect.objectContaining({ id: printingB }),
    ]))
    const reverse = await queryEntity<{ decks: { items: { id: string }[] } }>(
      database.sql,
      entities,
      'Card',
      {
        fields: ['decks'],
        where: { id: cardA },
      },
    )
    expect(reverse[0]?.decks.items).toEqual([expect.objectContaining({ id: deckA })])
    const filtered = await queryEntity<{
      entries: { $matched: number, $total: number, items: Record<string, unknown>[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'entries[quantity > 1]', 'entries.printing'],
      where: { id: deckA },
    })
    expect(filtered[0]?.entries.$matched).toBe(1)
    expect(filtered[0]?.entries.items).toEqual([
      expect.objectContaining({
        printing: expect.objectContaining({ id: printingB }),
        quantity: 3,
      }),
    ])
    const entityPage = await queryEntity<{
      cards: { $matched: number, $total: number, items: { entity: string, id: string, name: string }[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'cards{$orderBy:-name,$limit:1}'],
      where: { id: deckA },
    })
    const recordPage = await queryEntity<{
      entries: { $matched: number, $total: number, items: Record<string, unknown>[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'entries{$orderBy:-quantity,$limit:1}'],
      where: { id: deckA },
    })
    expect(entityPage[0]?.cards).toMatchObject({ $matched: 2, $total: 2 })
    expect(entityPage[0]?.cards.items).toEqual([
      expect.objectContaining({ entity: 'Card', id: cardB, name: 'Card B' }),
    ])
    expect(recordPage[0]?.entries).toMatchObject({ $matched: 2, $total: 2 })
    expect(recordPage[0]?.entries.items).toEqual([
      expect.objectContaining({ quantity: 3 }),
    ])
    expect(recordPage[0]?.entries.items[0]).not.toHaveProperty('id')
    expect(recordPage[0]?.entries.items[0]).not.toHaveProperty('entity')
    const emptyEntity = await queryEntity<{
      cards: { $matched: number, $total: number, items: unknown[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'cards'],
      where: { id: deckB },
    })
    const emptyRecord = await queryEntity<{
      entries: { $matched: number, $total: number, items: unknown[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'entries'],
      where: { id: deckB },
    })
    expect(emptyEntity[0]?.cards).toEqual({ $matched: 0, $total: 0, items: [] })
    expect(emptyRecord[0]?.entries).toEqual({ $matched: 0, $total: 0, items: [] })

    expect(entities.ddl.join('\n')).toContain('primary key ("deck.id", "card.id", "printing.id")')
    expect(await database.captureError(async db => {
      await db.sql`
        INSERT INTO "DeckCardPrinting" ("deck.id", "card.id", "printing.id", "quantity")
        VALUES
          (${deckA}, ${cardA}, ${printingA}, 1)
      `
    })).toMatchObject({ errno: '23505' })
  })

  isolatedTest('orders and pages relationship-record collections deterministically', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            {
              field: 'entries',
              target: 'DeckCardPrinting',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @]',
            },
            {
              field: 'largeEntries',
              target: 'DeckCardPrinting',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @ $and quantity > 2]',
            },
            {
              field: 'largePrintings',
              target: 'Printing',
              type: 'Collection',
              via: 'largeEntries.printing',
            },
            {
              field: 'hugePrintings',
              target: 'Printing',
              type: 'Collection',
              via: 'largeEntries[quantity > 5].printing',
            },
          ],
          name: 'Deck',
        },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Card' },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Printing' },
      ],
      relationships: [{
        between: [
          { field: 'deck', target: 'Deck' },
          { field: 'card', target: 'Card' },
          { field: 'printing', target: 'Printing' },
        ],
        fields: [{ field: 'quantity', type: 'Number' }],
        name: 'DeckCardPrinting',
      }],
    }))
    await database.use(entities)
    const deck = '00000000-0000-4000-8000-000000000d01'
    const cards = [
      '00000000-0000-4000-8000-000000000d11',
      '00000000-0000-4000-8000-000000000d12',
      '00000000-0000-4000-8000-000000000d13',
      '00000000-0000-4000-8000-000000000d14',
    ]
    const printings = [
      '00000000-0000-4000-8000-000000000d21',
      '00000000-0000-4000-8000-000000000d22',
      '00000000-0000-4000-8000-000000000d23',
      '00000000-0000-4000-8000-000000000d24',
    ]
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${deck}, 'Deck', 'Deck'),
        (${cards[0]}, 'Card 1', 'Card'),
        (${cards[1]}, 'Card 2', 'Card'),
        (${cards[2]}, 'Card 3', 'Card'),
        (${cards[3]}, 'Card 4', 'Card'),
        (${printings[0]}, 'Printing 1', 'Printing'),
        (${printings[1]}, 'Printing 2', 'Printing'),
        (${printings[2]}, 'Printing 3', 'Printing'),
        (${printings[3]}, 'Printing 4', 'Printing')
    `
    await database.sql`
      INSERT INTO "Deck" ("id")
      VALUES
        (${deck})
    `
    for (const [index, card] of cards.entries()) {
      await database.sql`
        INSERT INTO "Card" ("id")
        VALUES
          (${card})
      `
      await database.sql`
        INSERT INTO "Printing" ("id")
        VALUES
          (${printings[index]})
      `
    }
    const quantities = [7, 2, 9, 4]
    for (const [index, quantity] of quantities.entries()) {
      await database.sql`
        INSERT INTO "DeckCardPrinting" ("deck.id", "card.id", "printing.id", "quantity")
        VALUES
          (${deck}, ${cards[index]}, ${printings[index]}, ${quantity})
      `
    }
    const query = (path: string) => queryEntity<{
      entries: { $matched: number, $total: number, items: { quantity: number }[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', path],
      where: { id: deck },
    })
    const first = await query('entries{$orderBy:-quantity,$limit:2}')
    expect(first[0]?.entries.items.map(item => item.quantity)).toEqual([9, 7])
    expect(first[0]?.entries.$matched).toBe(4)
    expect(first[0]?.entries.$total).toBe(4)
    const second = await query('entries{$orderBy:-quantity,$limit:2,$offset:2}')
    expect(second[0]?.entries.items.map(item => item.quantity)).toEqual([4, 2])
    expect(second[0]?.entries.$matched).toBe(4)
    expect(second[0]?.entries.$total).toBe(4)
    expect((await query('entries{$orderBy:-quantity,$limit:2}'))[0]?.entries.items)
      .toEqual(first[0]?.entries.items)
    const filtered = await queryEntity<{
      hugePrintings: { $matched: number, $total: number, items: { id: string }[] },
      largeEntries: { $matched: number, $total: number, items: { quantity: number }[] },
      largePrintings: { $matched: number, $total: number, items: { id: string }[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'largeEntries{$orderBy:-quantity}', 'largePrintings', 'hugePrintings'],
      where: { id: deck },
    })
    expect(filtered[0]?.largeEntries.items.map(item => item.quantity)).toEqual([9, 7, 4])
    expect(filtered[0]?.largeEntries.$matched).toBe(3)
    expect(filtered[0]?.largeEntries.$total).toBe(3)
    expect(filtered[0]?.largePrintings.items).toHaveLength(3)
    expect(filtered[0]?.hugePrintings.$matched).toBe(2)
    expect(filtered[0]?.hugePrintings.items).toHaveLength(2)
  })

  isolatedTest('applies canonical via filters without cross-parent leakage', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            {
              field: 'entries',
              target: 'DeckCardPrinting',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @]',
            },
            {
              field: 'largeEntries',
              target: 'DeckCardPrinting',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @ $and quantity > 1]',
            },
            {
              field: 'largePrintings',
              target: 'Printing',
              type: 'Collection',
              via: 'largeEntries.printing',
            },
            {
              field: 'specialEntries',
              target: 'DeckCardPrinting',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @ $and (quantity = 0 $or quantity = 10)]',
            },
          ],
          name: 'Deck',
        },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Card' },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Printing' },
      ],
      relationships: [{
        between: [
          { field: 'deck', target: 'Deck' },
          { field: 'card', target: 'Card' },
          { field: 'printing', target: 'Printing' },
        ],
        fields: [{ field: 'quantity', type: 'Number' }],
        name: 'DeckCardPrinting',
      }],
    }))
    await database.use(entities)
    const decks = [
      '00000000-0000-4000-8000-000000000e01',
      '00000000-0000-4000-8000-000000000e02',
    ]
    const cardIds = ['e11', 'e12', 'e13', 'e14', 'e15'].map(value => `00000000-0000-4000-8000-000000000${value}`)
    const printingIds = ['e21', 'e22', 'e23', 'e24', 'e25'].map(value => `00000000-0000-4000-8000-000000000${value}`)
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${decks[0]}, 'Deck A', 'Deck'),
        (${decks[1]}, 'Deck B', 'Deck'),
        (${cardIds[0]}, 'Card A0', 'Card'),
        (${cardIds[1]}, 'Card A1', 'Card'),
        (${cardIds[2]}, 'Card A2', 'Card'),
        (${cardIds[3]}, 'Card A5', 'Card'),
        (${cardIds[4]}, 'Card A10', 'Card'),
        (${printingIds[0]}, 'Printing A0', 'Printing'),
        (${printingIds[1]}, 'Printing A1', 'Printing'),
        (${printingIds[2]}, 'Printing A2', 'Printing'),
        (${printingIds[3]}, 'Printing A5', 'Printing'),
        (${printingIds[4]}, 'Printing A10', 'Printing')
    `
    for (const deck of decks) {
      await database.sql`
        INSERT INTO "Deck" ("id")
        VALUES
          (${deck})
      `
    }
    for (const [index, card] of cardIds.entries()) {
      await database.sql`
        INSERT INTO "Card" ("id")
        VALUES
          (${card})
      `
      await database.sql`
        INSERT INTO "Printing" ("id")
        VALUES
          (${printingIds[index]})
      `
    }
    const quantities = [0, 1, 2, 5, 10]
    for (const [index, quantity] of quantities.entries()) {
      for (const [deckIndex, deck] of decks.entries()) {
        await database.sql`
          INSERT INTO "DeckCardPrinting" ("deck.id", "card.id", "printing.id", "quantity")
          VALUES
            (${deck}, ${cardIds[index]}, ${printingIds[index]}, ${quantity + deckIndex})
        `
      }
    }
    const read = (path: string) => queryEntity<Record<string, {
      $matched: number,
      $total: number,
      items: Record<string, unknown>[],
    }>>(database.sql, entities, 'Deck', {
      fields: ['id', path],
      where: { id: decks[0] },
    })
    const entries = await read('entries{$limit:null}')
    expect(entries[0]?.entries.$matched).toBe(5)
    expect(entries[0]?.entries.items.map(item => item.quantity)).toEqual([0, 1, 2, 5, 10])
    const large = await read('largeEntries')
    expect(large[0]?.largeEntries.$matched).toBe(3)
    expect(large[0]?.largeEntries.items.map(item => item.quantity)).toEqual([2, 5, 10])
    const largePrintings = await read('largePrintings')
    expect(largePrintings[0]?.largePrintings.$matched).toBe(3)
    expect(largePrintings[0]?.largePrintings.items.map(item => item.id)).toEqual([
      printingIds[2],
      printingIds[3],
      printingIds[4],
    ])
    const special = await read('specialEntries')
    expect(special[0]?.specialEntries.items.map(item => item.quantity)).toEqual([0, 10])
    const combined = await read('largeEntries[quantity > 5]')
    expect(combined[0]?.largeEntries.items.map(item => item.quantity)).toEqual([10])
    expect(combined[0]?.largeEntries.$matched).toBe(1)
    expect(combined[0]?.largeEntries.$total).toBe(3)
    const sameRecord = await read('largeEntries[quantity > 1 $and quantity < 5]')
    expect(sameRecord[0]?.largeEntries.items.map(item => item.quantity)).toEqual([2])
    expect(sameRecord[0]?.largeEntries.$matched).toBe(1)
    expect(sameRecord[0]?.largeEntries.$total).toBe(3)
  })

  isolatedTest('honors via default and query collection ordering consistently', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            {
              field: 'entries',
              target: 'DeckCardPrinting',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @]',
            },
            {
              field: 'orderedEntries',
              target: 'DeckCardPrinting',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @]{$orderBy:-quantity}',
            },
          ],
          name: 'Deck',
        },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Card' },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Printing' },
      ],
      relationships: [{
        between: [
          { field: 'deck', target: 'Deck' },
          { field: 'card', target: 'Card' },
          { field: 'printing', target: 'Printing' },
        ],
        fields: [{ field: 'quantity', type: 'Number' }],
        name: 'DeckCardPrinting',
      }],
    }))
    await database.use(entities)
    const deckA = '00000000-0000-4000-8000-000000000f01'
    const deckB = '00000000-0000-4000-8000-000000000f02'
    const cards = ['f11', 'f12', 'f13', 'f14', 'f15', 'f16', 'f17', 'f18']
      .map(value => `00000000-0000-4000-8000-000000000${value}`)
    const printings = ['f21', 'f22', 'f23', 'f24', 'f25', 'f26', 'f27', 'f28']
      .map(value => `00000000-0000-4000-8000-000000000${value}`)
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${deckA}, 'Deck A', 'Deck'),
        (${deckB}, 'Deck B', 'Deck'),
        (${cards[0]}, 'Card A0', 'Card'),
        (${cards[1]}, 'Card A1', 'Card'),
        (${cards[2]}, 'Card A2', 'Card'),
        (${cards[3]}, 'Card A5', 'Card'),
        (${cards[4]}, 'Card A10', 'Card'),
        (${cards[5]}, 'Card B5a', 'Card'),
        (${cards[6]}, 'Card B5b', 'Card'),
        (${cards[7]}, 'Card B1', 'Card'),
        (${printings[0]}, 'Printing A0', 'Printing'),
        (${printings[1]}, 'Printing A1', 'Printing'),
        (${printings[2]}, 'Printing A2', 'Printing'),
        (${printings[3]}, 'Printing A5', 'Printing'),
        (${printings[4]}, 'Printing A10', 'Printing'),
        (${printings[5]}, 'Printing B5a', 'Printing'),
        (${printings[6]}, 'Printing B5b', 'Printing'),
        (${printings[7]}, 'Printing B1', 'Printing')
    `
    await database.sql`
      INSERT INTO "Deck" ("id")
      VALUES
        (${deckA}),
        (${deckB})
    `
    for (const [index, card] of cards.entries()) {
      await database.sql`
        INSERT INTO "Card" ("id")
        VALUES
          (${card})
      `
      await database.sql`
        INSERT INTO "Printing" ("id")
        VALUES
          (${printings[index]})
      `
    }
    const rows = [
      [deckA, cards[0], printings[0], 0],
      [deckA, cards[1], printings[1], 1],
      [deckA, cards[2], printings[2], 2],
      [deckA, cards[3], printings[3], 5],
      [deckA, cards[4], printings[4], 10],
      [deckB, cards[5], printings[5], 5],
      [deckB, cards[6], printings[6], 5],
      [deckB, cards[7], printings[7], 1],
    ] as const
    for (const [deck, card, printing, quantity] of rows) {
      await database.sql`
        INSERT INTO "DeckCardPrinting" ("deck.id", "card.id", "printing.id", "quantity")
        VALUES
          (${deck}, ${card}, ${printing}, ${quantity})
      `
    }
    const read = (deck: string, path: string) => queryEntity<Record<string, {
      $matched: number,
      $total: number,
      items: { card: { id: string }, quantity: number }[],
    }>>(database.sql, entities, 'Deck', {
      fields: ['id', path],
      where: { id: deck },
    })
    const quantities = (path: string, deck = deckA) => read(deck, path).then(result => (
      result[0]?.[path.split('[')[0]?.split('{')[0] ?? '']?.items.map(item => item.quantity)
    ))
    expect(await quantities('entries{$orderBy:-quantity,$limit:null}')).toEqual([10, 5, 2, 1, 0])
    expect(await quantities('orderedEntries{$limit:null}')).toEqual([10, 5, 2, 1, 0])
    expect(await quantities('orderedEntries{$limit:2}')).toEqual([10, 5])
    expect(await quantities('orderedEntries{$limit:2,$offset:2}')).toEqual([2, 1])
    expect(await quantities('entries{$orderBy:-quantity,$limit:2}')).toEqual([10, 5])
    expect(await quantities('entries{$orderBy:-quantity,$limit:2,$offset:2}')).toEqual([2, 1])
    const filtered = await read(deckA, 'entries[quantity > 1]{$orderBy:-quantity,$limit:2}')
    expect(filtered[0]?.entries.$matched).toBe(3)
    expect(filtered[0]?.entries.$total).toBe(5)
    expect(filtered[0]?.entries.items.map(item => item.quantity)).toEqual([10, 5])
    expect(await quantities('orderedEntries{$orderBy:quantity,$limit:2}')).toEqual([0, 1])
    expect(await quantities('entries{$limit:2}')).toEqual(await quantities('entries{$limit:2}'))
    expect((await read(deckA, 'entries{$orderBy:-quantity,$limit:2}'))[0]?.entries.items)
      .toEqual((await read(deckA, 'entries{$orderBy:-quantity,$limit:2}'))[0]?.entries.items)
    await expect(read(deckA, 'entries{$orderBy:missing}')).rejects.toThrow(/unknown relationship record order/i)
    const tied = await read(deckB, 'orderedEntries{$limit:null}')
    expect(tied[0]?.orderedEntries.items.map(item => item.quantity)).toEqual([5, 5, 1])
    expect(tied[0]?.orderedEntries.items.slice(0, 2).map(item => item.card.id)).toEqual([
      cards[5],
      cards[6],
    ])
  })

  isolatedTest('applies via defaults to projected Entity collections', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'entries', target: 'DeckCardPrinting', type: 'Collection', via: 'DeckCardPrinting[deck = @]' },
            {
              field: 'pagedEntries',
              target: 'DeckCardPrinting',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @]{$limit:2,$offset:1}',
            },
            {
              field: 'cards',
              target: 'Card',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @].card',
            },
            {
              field: 'pagedCards',
              target: 'Card',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @]{$limit:2,$offset:1}.card',
            },
            {
              field: 'sortedCards',
              target: 'Card',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @]{$orderBy:-name}.card',
            },
            {
              field: 'aliasedPagedCards',
              target: 'Card',
              type: 'Collection',
              via: 'pagedEntries.card',
            },
            {
              field: 'filteredEntries',
              target: 'DeckCardPrinting',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @ $and quantity > 1]',
            },
            {
              field: 'filteredCards',
              target: 'Card',
              type: 'Collection',
              via: 'filteredEntries.card',
            },
          ],
          name: 'Deck',
        },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Card' },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Printing' },
      ],
      relationships: [{
        between: [
          { field: 'deck', target: 'Deck' },
          { field: 'card', target: 'Card' },
          { field: 'printing', target: 'Printing' },
        ],
        fields: [{ field: 'quantity', type: 'Number' }],
        name: 'DeckCardPrinting',
      }],
    }))
    await database.use(entities)
    const deck = '00000000-0000-4000-8000-000000000a01'
    const cardIds = ['a11', 'a12', 'a13', 'a14', 'a15'].map(value => `00000000-0000-4000-8000-000000000${value}`)
    const printingIds = ['a21', 'a22', 'a23', 'a24', 'a25'].map(value => `00000000-0000-4000-8000-000000000${value}`)
    const names = ['Zulu', 'Alpha', 'Mike', 'Echo', 'Bravo']
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${deck}, 'Deck', 'Deck'),
        (${cardIds[0]}, ${names[0]}, 'Card'),
        (${cardIds[1]}, ${names[1]}, 'Card'),
        (${cardIds[2]}, ${names[2]}, 'Card'),
        (${cardIds[3]}, ${names[3]}, 'Card'),
        (${cardIds[4]}, ${names[4]}, 'Card'),
        (${printingIds[0]}, 'Printing 1', 'Printing'),
        (${printingIds[1]}, 'Printing 2', 'Printing'),
        (${printingIds[2]}, 'Printing 3', 'Printing'),
        (${printingIds[3]}, 'Printing 4', 'Printing'),
        (${printingIds[4]}, 'Printing 5', 'Printing')
    `
    await database.sql`
      INSERT INTO "Deck" ("id")
      VALUES
        (${deck})
    `
    for (const [index, card] of cardIds.entries()) {
      await database.sql`
        INSERT INTO "Card" ("id")
        VALUES
          (${card})
      `
      await database.sql`
        INSERT INTO "Printing" ("id")
        VALUES
          (${printingIds[index]})
      `
    }
    const quantities = [0, 1, 2, 5, 10]
    for (const [index, quantity] of quantities.entries()) {
      await database.sql`
        INSERT INTO "DeckCardPrinting" ("deck.id", "card.id", "printing.id", "quantity")
        VALUES
          (${deck}, ${cardIds[index]}, ${printingIds[index]}, ${quantity})
      `
    }
    const query = <T>(field: string) => queryEntity<T>(database.sql, entities, 'Deck', {
      fields: ['id', field],
      where: { id: deck },
    })
    const ids = (rows: Record<string, { items: { id: string }[] }>[], field: string) => (
      rows[0]?.[field]?.items.map(item => item.id)
    )
    expect(ids(await query('pagedCards'), 'pagedCards'))
      .toEqual(ids(await query('cards{$limit:2,$offset:1}'), 'cards'))
    expect(ids(await query('aliasedPagedCards'), 'aliasedPagedCards'))
      .toEqual(ids(await query('cards{$limit:2,$offset:1}'), 'cards'))
    const sorted = await query<{ sortedCards: { items: { name: string }[] } }>('sortedCards{$limit:null}')
    expect(sorted[0]?.sortedCards.items.map(item => item.name)).toEqual([
      'Zulu',
      'Mike',
      'Echo',
      'Bravo',
      'Alpha',
    ])
    const override = await query<{ pagedCards: { items: { id: string }[] } }>(
      'pagedCards{$limit:3,$offset:0}',
    )
    expect(override[0]?.pagedCards.items.map(item => item.id))
      .toEqual(cardIds.slice(0, 3))
    const orderOverride = await query<{ sortedCards: { items: { name: string }[] } }>(
      'sortedCards{$orderBy:name,$limit:null}',
    )
    expect(orderOverride[0]?.sortedCards.items.map(item => item.name)).toEqual([
      'Alpha',
      'Bravo',
      'Echo',
      'Mike',
      'Zulu',
    ])
    const counts = await query<{ pagedCards: { $matched: number, $total: number } }>('pagedCards')
    expect(counts[0]?.pagedCards).toMatchObject({ $matched: 5, $total: 5 })
    const filtered = await query<{
      filteredCards: { $matched: number, $total: number, items: { name: string }[] },
    }>("filteredCards[name != 'Echo']")
    expect(filtered[0]?.filteredCards.$matched).toBe(2)
    expect(filtered[0]?.filteredCards.$total).toBe(3)
    expect(filtered[0]?.filteredCards.items.map(item => item.name)).toEqual(['Mike', 'Bravo'])
  })

  isolatedTest('counts distinct projected Entity targets across multi-edge relationships', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'entries', target: 'DeckCardPrinting', type: 'Collection', via: 'DeckCardPrinting[deck = @]' },
            { field: 'cards', target: 'Card', type: 'Collection', via: 'DeckCardPrinting[deck = @].card' },
            {
              field: 'filteredCards',
              target: 'Card',
              type: 'Collection',
              via: 'DeckCardPrinting[deck = @ $and quantity > 3].card',
            },
          ],
          name: 'Deck',
        },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Card' },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Printing' },
      ],
      relationships: [{
        between: [
          { field: 'deck', target: 'Deck' },
          { field: 'card', target: 'Card' },
          { field: 'printing', target: 'Printing' },
        ],
        fields: [{ field: 'quantity', type: 'Number' }],
        name: 'DeckCardPrinting',
      }],
    }))
    await database.use(entities)
    const deck = '00000000-0000-4000-8000-000000000901'
    const cardX = '00000000-0000-4000-8000-000000000902'
    const cardY = '00000000-0000-4000-8000-000000000903'
    const printing1 = '00000000-0000-4000-8000-000000000904'
    const printing2 = '00000000-0000-4000-8000-000000000905'
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${deck}, 'Deck', 'Deck'),
        (${cardX}, 'Card X', 'Card'),
        (${cardY}, 'Card Y', 'Card'),
        (${printing1}, 'Printing 1', 'Printing'),
        (${printing2}, 'Printing 2', 'Printing')
    `
    await database.sql`
      INSERT INTO "Deck" ("id")
      VALUES
        (${deck})
    `
    await database.sql`
      INSERT INTO "Card" ("id")
      VALUES
        (${cardX}),
        (${cardY})
    `
    await database.sql`
      INSERT INTO "Printing" ("id")
      VALUES
        (${printing1}),
        (${printing2})
    `
    await database.sql`
      INSERT INTO "DeckCardPrinting" ("deck.id", "card.id", "printing.id", "quantity")
      VALUES
        (${deck}, ${cardX}, ${printing1}, 2),
        (${deck}, ${cardX}, ${printing2}, 5),
        (${deck}, ${cardY}, ${printing1}, 1)
    `
    const [envelope] = await queryEntity<{
      cards: { $matched: number, $total: number, items: { id: string }[] },
      filteredCards: { $matched: number, $total: number, items: { id: string }[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'cards', 'filteredCards'],
      where: { id: deck },
    })
    expect(envelope?.cards).toEqual({
      $matched: 2,
      $total: 2,
      items: expect.arrayContaining([
        expect.objectContaining({ id: cardX }),
        expect.objectContaining({ id: cardY }),
      ]),
    })
    expect(envelope?.filteredCards).toEqual({
      $matched: 1,
      $total: 1,
      items: [expect.objectContaining({ id: cardX })],
    })
    const records = await queryEntity<{ entries: { $matched: number } }>(
      database.sql,
      entities,
      'Deck',
      { fields: ['id', 'entries'], where: { id: deck } },
    )
    expect(records[0]?.entries.$matched).toBe(3)
    const filteredByEdge = await queryEntity<{
      cards: { $matched: number, $total: number, items: { id: string }[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'cards[quantity > 3]'],
      where: { id: deck },
    })
    expect(filteredByEdge[0]?.cards.$matched).toBe(1)
    expect(filteredByEdge[0]?.cards.$total).toBe(2)
    expect(filteredByEdge[0]?.cards.items).toEqual([expect.objectContaining({ id: cardX })])
    const noEdge = await queryEntity<{
      cards: { $matched: number, $total: number, items: unknown[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'cards[quantity > 6]'],
      where: { id: deck },
    })
    expect(noEdge[0]?.cards).toMatchObject({ $matched: 0, $total: 2, items: [] })
    const sameEdge = await queryEntity<{
      cards: { $matched: number, items: { id: string }[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', "cards[name = 'Card X' $and quantity > 3]"],
      where: { id: deck },
    })
    expect(sameEdge[0]?.cards.$matched).toBe(1)
    expect(sameEdge[0]?.cards.items).toEqual([expect.objectContaining({ id: cardX })])
    const wrongTarget = await queryEntity<{
      cards: { $matched: number, items: unknown[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', "cards[name = 'Card Y' $and quantity > 3]"],
      where: { id: deck },
    })
    expect(wrongTarget[0]?.cards).toMatchObject({ $matched: 0, items: [] })
    const recordEdge = await queryEntity<{
      entries: { $matched: number, items: { printing: { id: string }, quantity: number }[] },
    }>(database.sql, entities, 'Deck', {
      fields: ['id', 'entries[quantity > 3]'],
      where: { id: deck },
    })
    expect(recordEdge[0]?.entries.$matched).toBe(1)
    expect(recordEdge[0]?.entries.items).toEqual([
      expect.objectContaining({ printing: expect.objectContaining({ id: printing2 }), quantity: 5 }),
    ])
    const allRecords = await queryEntity<{ entries: { items: unknown[] } }>(
      database.sql,
      entities,
      'Deck',
      { fields: ['id', 'entries{$limit:null}'], where: { id: deck } },
    )
    expect(allRecords[0]?.entries.items).toHaveLength(3)
    const roots = (where: string) => queryEntity<{ id: string }>(database.sql, entities, 'Deck', {
      fields: ['id'],
      where,
    })
    expect(await roots('cards.$total = 2')).toEqual([{ id: deck }])
    expect(await roots('cards $empty')).toEqual([])
    expect(await roots("cards $contains (name = 'Card X')")).toEqual([{ id: deck }])
    expect(await roots('filteredCards.$total = 1')).toEqual([{ id: deck }])
    expect(await roots('filteredCards.$matched = 1')).toEqual([{ id: deck }])
    expect(await roots('cards[quantity > 3].$matched = 1')).toEqual([{ id: deck }])
    expect(await roots('cards[quantity > 3].$total = 2')).toEqual([{ id: deck }])
  })

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
      JOIN pg_class ON pg_class.relname = indexname
        AND pg_class.relnamespace = current_schema()::regnamespace
      JOIN pg_index ON pg_index.indexrelid = pg_class.oid
      WHERE schemaname = current_schema()
        AND tablename = 'Pet'
        AND indexname LIKE 'Pet_%_fk_idx'
      ORDER BY indexname
    `).toEqual([
      { indexName: 'Pet_guardian_fk_idx', isUnique: true },
      { indexName: 'Pet_owner_fk_idx', isUnique: false },
    ])
    await database.sql`
      DROP INDEX "Pet_guardian_fk_idx"
    `
    await database.sql`
      CREATE UNIQUE INDEX "Pet_guardian_fk_idx" ON "Pet"("id")
    `
    await expect(installSchema(database.sql, entities))
      .rejects.toThrow('index definition changed: Pet.Pet_guardian_fk_idx')
    await database.sql`
      DROP INDEX "Pet_guardian_fk_idx"
    `
    await database.sql`
      CREATE UNIQUE INDEX "Pet_guardian_fk_idx" ON "Pet"("guardian.id")
      WHERE FALSE
    `
    await expect(installSchema(database.sql, entities))
      .rejects.toThrow('Migration plan has blocking drift')
    await database.sql`
      DROP INDEX "Pet_guardian_fk_idx"
    `
    await database.sql`
      CREATE UNIQUE INDEX "Pet_guardian_fk_idx" ON "Pet"("guardian.id", LOWER("id"))
    `
    await expect(installSchema(database.sql, entities))
      .rejects.toThrow('Migration plan has blocking drift')
    await database.sql`
      DROP INDEX "Pet_guardian_fk_idx"
    `
    await database.sql`
      CREATE UNIQUE INDEX "Pet_guardian_fk_idx" ON "Pet"("guardian.id") NULLS NOT DISTINCT
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
      VALUES
        (${personOne}, 'Ada', 'Person'),
        (${personTwo}, 'Grace', 'Person'),
        (${personThree}, 'Linus', 'Person'),
        (${petOne}, 'Pet One', 'Pet'),
        (${petTwo}, 'Pet Two', 'Pet'),
        (${petThree}, 'Pet Three', 'Pet')
    `
    await database.sql`
      INSERT INTO "Person" ("id")
      VALUES
        (${personOne}),
        (${personTwo}),
        (${personThree})
    `
    await database.sql`
      INSERT INTO "Pet" ("id", "owner.id", "guardian.id")
      VALUES
        (${petOne}, ${personOne}, ${personOne}),
        (${petTwo}, ${personOne}, ${null}),
        (${petThree}, ${personTwo}, ${personTwo})
    `
    expect(await database.captureError(async db => {
      await db.sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${'00000000-0000-4000-8000-000000000014'}, 'Duplicate', 'Pet')
      `
      await db.sql`
        INSERT INTO "Pet" ("id", "owner.id", "guardian.id")
        VALUES
          (${'00000000-0000-4000-8000-000000000014'}, ${personOne}, ${personOne})
      `
    })).toMatchObject({ errno: '23505' })

    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'Person', {
      fields: ['id', 'pet', 'pets{$limit:1}'],
      orderBy: 'id',
      where: { id: personOne },
    })).toEqual([{
      id: personOne,
      pet: { entity: 'Pet', id: petOne, name: 'Pet One' },
      pets: {
        $matched: 2,
        $total: 2,
        items: [{ entity: 'Pet', id: petOne, name: 'Pet One' }],
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
      fields: ['id', 'owner.pets{$limit:1}'],
      where: { id: petOne },
    })).toEqual([{
      id: petOne,
      owner: {
        entity: 'Person',
        id: personOne,
        name: 'Ada',
        pets: {
          $matched: 2,
          $total: 2,
          items: [{ entity: 'Pet', id: petOne, name: 'Pet One' }],
        },
      },
    }])
  })

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
            { field: 'campaigns', target: 'Campaign', type: 'Collection', via: 'Membership[person = @].campaign' },
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
        }, {
          fields: [{
            field: 'id',
            format: 'UUID',
          },
          {
            field: 'members',
            target: 'Person',
            type: 'Collection',
            via: 'Membership[campaign = @].person',
          }],
          name: 'Campaign',
        },
      ],
      relationships: [{
        between: [
          { field: 'person', target: 'Person' },
          { field: 'campaign', target: 'Campaign' },
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
      VALUES
        (${ada}, 'Ada', 'Person'),
        (${grace}, 'Grace', 'Person'),
        (${linus}, 'Linus', 'Person'),
        (${dana}, 'Dana', 'Person'),
        (${rex}, 'Rex', 'Pet'),
        (${fido}, 'Fido', 'Pet'),
        (${rexTwo}, 'Rex Two', 'Pet'),
        (${fidoTwo}, 'Fido Two', 'Pet'),
        (${one}, 'Campaign One', 'Campaign'),
        (${two}, 'Campaign Two', 'Campaign'),
        (${three}, 'Campaign Three', 'Campaign'),
        (${four}, 'Campaign Four', 'Campaign'),
        (${five}, 'Campaign Five', 'Campaign')
    `
    await database.sql`
      INSERT INTO "Person" ("id", "title")
      VALUES
        (${ada}, 'Ada'),
        (${grace}, 'Grace'),
        (${linus}, 'Linus'),
        (${dana}, 'Dana')
    `
    await database.sql`
      INSERT INTO "Pet" ("id", "age", "title", "nickname", "owner.id", "vaccinated", "vet.id")
      VALUES
        (${rex}, 3, 'Rex', 'Loud', ${ada}, TRUE, ${grace}),
        (${fido}, 8, 'Fido', 'Quiet', ${ada}, TRUE, ${null}),
        (${rexTwo}, 12, 'Rex', 'Special', ${grace}, FALSE, ${grace}),
        (${fidoTwo}, 5, 'Fido', 'Other', ${dana}, TRUE, ${null})
    `
    await database.sql`
      INSERT INTO "Campaign" ("id")
      VALUES
        (${one}),
        (${two}),
        (${three}),
        (${four}),
        (${five})
    `
    await database.sql`
      INSERT INTO "Membership" ("person.id", "campaign.id", "role")
      VALUES
        (${ada}, ${one}, 'GM'),
        (${grace}, ${one}, 'Player'),
        (${linus}, ${one}, 'Player'),
        (${linus}, ${two}, 'GM'),
        (${grace}, ${three}, 'Player'),
        (${dana}, ${four}, 'Player')
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

    const projected = await queryEntity<{ id: string, pets: { $matched: number, $total: number } }>(
      database.sql,
      entities,
      'Person',
      {
        fields: ['id', 'pets{$limit:1}'],
        orderBy: 'id',
        where: "pets $contains (title = 'Rex')",
      },
    )
    expect(projected.map(row => row.id)).toEqual([ada, grace])
    expect(projected[0]?.pets.$total).toBe(2)
  })

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
      VALUES
        (${ada}, 'Ada', 'Person'),
        (${grace}, 'Grace', 'Person'),
        (${linus}, 'Linus', 'Person'),
        (${dana}, 'Dana', 'Person'),
        (${dogOne}, 'Dog One', 'Dog'),
        (${dogTwo}, 'Dog Two', 'Dog'),
        (${dogThree}, 'Dog Three', 'Dog'),
        (${catOne}, 'Cat One', 'Cat'),
        (${catTwo}, 'Cat Two', 'Cat')
    `
    await database.sql`
      INSERT INTO "Person" ("id", "title", "manager.id")
      VALUES
        (${ada}, 'Ada', ${null}),
        (${grace}, 'Grace', ${ada}),
        (${linus}, 'Linus', ${null}),
        (${dana}, 'Dana', ${null})
    `
    await database.sql`
      INSERT INTO "Base" ("id", "owner.id", "label")
      VALUES
        (${dogOne}, ${ada}, 'Dog One'),
        (${dogTwo}, ${grace}, 'Dog Two'),
        (${dogThree}, ${grace}, 'Dog Three'),
        (${catOne}, ${ada}, 'Cat One'),
        (${catTwo}, ${dana}, 'Cat Two')
    `
    await database.sql`
      INSERT INTO "Dog" ("id", "trait", "mentor.id")
      VALUES
        (${dogOne}, 'good', ${grace}),
        (${dogTwo}, 'good', ${ada}),
        (${dogThree}, 'good', ${null})
    `
    await database.sql`
      INSERT INTO "Cat" ("id", "lives")
      VALUES
        (${catOne}, 9),
        (${catTwo}, 9)
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
  })

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
      VALUES
        (${one}, 'One', 'Note'),
        (${two}, 'Two', 'Note'),
        (${three}, 'Three', 'Note'),
        (${four}, 'Four', 'Note'),
        (${five}, 'Five', 'Note'),
        (${six}, 'Six', 'Note')
    `
    await database.sql`
      INSERT INTO "Note" ("id", "tags", "scores", "payload")
      VALUES
        (${one}, ARRAY ['urgent', 'important'], ARRAY [1, 2, 2],
          '{"kind":"note","meta":{"active":true}}'::jsonb),
        (${two}, ARRAY ['urgent'], ARRAY [3], '{"kind":"other"}'::jsonb),
        (${three}, ARRAY []::text[], ARRAY []::double PRECISION[], '{}'::jsonb),
        (${four}, ARRAY ['b', 'a'], ARRAY [2, 1, 1], '["a","b"]'::jsonb),
        (${five}, ARRAY ['a', 'b'], ARRAY [1, 2], '{"kind":"note"}'::jsonb),
        (${six}, ARRAY ['c'], ARRAY [4], '{"kind":null}'::jsonb)
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
  })

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
      VALUES
        (${exact}, 'Exact', 'Note'),
        (${unsafe}, 'Unsafe', 'Note'),
        (${decimal}, 'Decimal', 'Note'),
        (${precise}, 'Precise', 'Note')
    `
    await database.sql`
      INSERT INTO "Note" ("id", "payload")
      VALUES
        (${exact}, '{"account":9007199254740991}'::jsonb),
        (${unsafe}, '{"account":9007199254740993}'::jsonb),
        (${decimal}, '{"amount":1}'::jsonb),
        (${precise}, '{"amount":1.0000000000000001}'::jsonb)
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
  })

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
      CREATE TABLE "Other" (
        "id" TEXT PRIMARY KEY
      )
    `
    await database.sql`
      CREATE UNIQUE INDEX "Pet_owner_fk_idx" ON "Other"("id")
    `
    await expect(installSchema(database.sql, entities))
      .rejects.toThrow('Migration plan has blocking drift')
  })

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
      CREATE TABLE "Pet_owner_fk_idx" (
        "id" TEXT PRIMARY KEY
      )
    `
    await expect(installSchema(database.sql, entities))
      .rejects.toThrow('unexpected table: Pet_owner_fk_idx')
  })

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
      VALUES
        (${petOne}, 'Pet One', 'Pet'),
        (${petTwo}, 'Pet Two', 'Pet'),
        ('1001', 'Special Visit', 'SpecialVisit'),
        ('1002', 'Second Special Visit', 'SpecialVisit')
    `
    await database.sql`
      INSERT INTO "Pet" ("id")
      VALUES
        (${petOne}),
        (${petTwo})
    `
    await database.sql`
      INSERT INTO "Visit" ("id", "pet.id")
      VALUES
        ('1001', ${petOne}),
        ('1002', ${petOne})
    `
    await database.sql`
      INSERT INTO "SpecialVisit" ("id", "notes")
      VALUES
        ('1001', 'note'),
        ('1002', 'other')
    `
    expect(await queryEntity<Record<string, unknown>>(database.sql, entities, 'Pet', {
      fields: ['id', 'visits'],
      orderBy: 'id',
    })).toEqual([
      {
        id: petOne,
        visits: {
          $matched: 2,
          $total: 2,
          items: [
            { entity: 'SpecialVisit', id: '1001', name: 'Special Visit' },
            { entity: 'SpecialVisit', id: '1002', name: 'Second Special Visit' },
          ],
        },
      },
      {
        id: petTwo,
        visits: { $matched: 0, $total: 0, items: [] },
      },
    ])
  })

  fixtureTest('enforces MTI final-state integrity for direct SQL', async database => {
    const id = randomUUID()
    await database.tx(async sql => {
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${id}, ${'Ada'}, ${'MtiSystemUser'})
      `
      await sql`
        INSERT INTO "MtiUser" ("id", "label", "email")
        VALUES
          (${id}, ${'Ada'}, ${'ada@example.test'})
      `
      await sql`
        INSERT INTO "MtiSystemUser" ("id", "permissions", "manager.id")
        VALUES
          (${id}, ${'admin'}, ${id})
      `
      await sql`
        SET constraints ALL immediate
      `
    })

    const incompleteId = randomUUID()
    const incomplete = await database.tx(async sql => {
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${incompleteId}, ${'Incomplete'}, ${'MtiSystemUser'})
      `
      await sql`
        SET constraints ALL immediate
      `
    }).catch((error: unknown) => error)
    expect(incomplete).toMatchObject({ errno: 'P0001' })

    const missingParentId = randomUUID()
    const missingParent = await database.tx(async sql => {
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${missingParentId}, ${'Missing parent'}, ${'MtiSystemUser'})
      `
      await sql`
        INSERT INTO "MtiSystemUser" ("id", "permissions", "manager.id")
        VALUES
          (${missingParentId}, ${'admin'}, ${missingParentId})
      `
      await sql`
        SET constraints ALL immediate
      `
    }).catch((error: unknown) => error)
    expect(missingParent).toMatchObject({ errno: 'P0001' })

    const deleteFailure = await database.tx(async sql => {
      await sql`
        DELETE FROM "MtiSystemUser"
        WHERE "id" = ${id}
      `
      await sql`
        SET constraints ALL immediate
      `
    }).catch((error: unknown) => error)
    expect(deleteFailure).toMatchObject({ errno: 'P0001' })
  })

  isolatedTest('filters numeric values with each comparison operator', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [numberRowDefinition],
    }))
    await database.use(entities)
    await database.sql`
      WITH rows AS (
        SELECT gen_random_uuid()::text AS id, value
        FROM generate_series(1, 10) AS series(value)
      ),
      roots AS (
        INSERT INTO "Entity"("id", "name", "entity")
        SELECT id, 'Number ' || value, 'NumberRow'
        FROM rows
      )
      INSERT INTO "NumberRow"("id", "value")
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
  })

  isolatedTest('creates and enforces many-to-one foreign keys', async database => {
    const entities = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'author', target: 'MtiUser', type: 'Entity' },
            { field: 'title', type: 'String' },
          ],
          name: 'Post',
        },
        {
          fields: [
            { field: 'id', format: 'Snowflake' },
            { field: 'label', type: 'String' },
          ],
          name: 'MtiUser',
        },
      ],
    }))

    await database.use(entities)

    const constraints = await database.sql<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = '"Post"'::regclass
        AND contype = 'f'
      ORDER BY conname collate "C"
    `
    expect(constraints).toEqual([
      { definition: 'FOREIGN KEY (id) REFERENCES "Entity"(id) DEFERRABLE' },
      { definition: 'FOREIGN KEY ("author.id") REFERENCES "MtiUser"(id) DEFERRABLE' },
    ])

    const userId = '9223372036854775807'
    const postId = randomUUID()
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${userId}, ${'Ada'}, ${'MtiUser'}),
        (${postId}, ${'Hello'}, ${'Post'})
    `
    await database.sql`
      INSERT INTO "MtiUser" ("id", "label")
      VALUES
        (${userId}, ${'Ada'})
    `
    await database.sql`
      INSERT INTO "Post" ("id", "author.id", "title")
      VALUES
        (${postId}, ${userId}, ${'Hello'})
    `
    expect(await database.sql<{ userId: string }[]>`
      SELECT "author.id"::text AS "userId"
      FROM "Post"
    `).toEqual([{ userId }])

    const invalidId = randomUUID()
    await database.sql`
      INSERT INTO "Entity" ("id", "name", "entity")
      VALUES
        (${invalidId}, ${'Invalid'}, ${'Post'})
    `
    const invalidInsert = await database.captureError(async db => {
      await db.sql`
        INSERT INTO "Post" ("id", "author.id", "title")
        VALUES
          (${invalidId}, ${'1'}, ${'Invalid'})
      `
    })
    expect(invalidInsert).toMatchObject({ errno: '23503' })

    const blockedDelete = await database.captureError(async db => {
      await db.sql`
        DELETE FROM "MtiUser"
        WHERE "id" = ${'9223372036854775807'}
      `
    })
    expect(blockedDelete).toMatchObject({ errno: '23503' })
    expect(await database.sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "Post"
    `).toEqual([{ count: 1 }])
  })

  fixtureTest('creates cyclic foreign keys and validates deferred references', async database => {
    const constraints = await database.tx(async sql => sql<{
      deferrable: boolean,
      deferred: boolean,
      definition: string,
      name: string,
    }[]>`
      SELECT
        conname AS name,
        condeferrable AS DEFERRABLE,
        condeferred AS deferred,
        pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid IN ('"CycleUser"'::regclass, '"CycleCar"'::regclass)
        AND contype = 'f'
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
        VALUES
          (${userId}, ${'User'}, ${'CycleUser'}),
          (${carId}, ${'Car'}, ${'CycleCar'})
      `
      await sql`
        INSERT INTO "CycleUser" ("id", "car.id")
        VALUES
          (${userId}, ${carId})
      `
      await sql`
        INSERT INTO "CycleCar" ("id", "user.id")
        VALUES
          (${carId}, ${userId})
      `
      await sql`
        SET constraints ALL immediate
      `
      expect(await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM "CycleUser"
      `).toEqual([{ count: 1 }])
    })

    const invalidCarId = randomUUID()
    const invalidUserId = randomUUID()
    const invalid = await database.tx(async sql => {
      await sql`
        SET constraints ALL deferred
      `
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${invalidUserId}, ${'Invalid user'}, ${'CycleUser'}),
          (${invalidCarId}, ${'Invalid car'}, ${'CycleCar'})
      `
      await sql`
        INSERT INTO "CycleUser" ("id", "car.id")
        VALUES
          (${invalidUserId}, ${invalidCarId})
      `
      await sql`
        INSERT INTO "CycleCar" ("id", "user.id")
        VALUES
          (${invalidCarId}, ${randomUUID()})
      `
      await sql`
        SET constraints ALL immediate
      `
    }).catch((error: unknown) => error)
    expect(invalid).toMatchObject({ errno: '23503' })
  })

  fixtureTest('enforces self-referential foreign keys', async database => {
    const nodeId = randomUUID()
    await database.tx(async sql => {
      await sql`
        SET constraints ALL deferred
      `
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${nodeId}, ${'Node'}, ${'TreeNode'})
      `
      await sql`
        INSERT INTO "TreeNode" ("id", "parent.id")
        VALUES
          (${nodeId}, ${nodeId})
      `
    })
    expect(await database.tx(async sql => sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "TreeNode"
    `)).toEqual([{ count: 1 }])

    const invalidNodeId = randomUUID()
    const invalid = await database.tx(async sql => {
      await sql`
        SET constraints ALL deferred
      `
      await sql`
        INSERT INTO "Entity" ("id", "name", "entity")
        VALUES
          (${invalidNodeId}, ${'Invalid node'}, ${'TreeNode'})
      `
      await sql`
        INSERT INTO "TreeNode" ("id", "parent.id")
        VALUES
          (${invalidNodeId}, ${randomUUID()})
      `
      await sql`
        SET constraints ALL immediate
      `
    }).catch((error: unknown) => error)
    expect(invalid).toMatchObject({ errno: '23503' })
  })

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
  })

  freshIsolatedTest('matches string and structured predicates with two-valued null semantics', async database => {
    // Raw nullable DDL exercises NULL semantics while the canonical entity drives query validation.
    await database.sql`
      CREATE TABLE "QueryRow" (
        "id" UUID PRIMARY KEY,
        "active" BOOLEAN,
        "externalId" DOUBLE PRECISION,
        "rank" DOUBLE PRECISION,
        "score" DOUBLE PRECISION,
        "title" TEXT
      )
    `
    await database.sql`
      INSERT INTO "QueryRow" ("id", "active", "externalId", "rank", "score", "title")
      VALUES
        (GEN_RANDOM_UUID(), NULL, ${7}, 1, NULL, NULL),
        (GEN_RANDOM_UUID(), TRUE, NULL, 2, 0, ''),
        (GEN_RANDOM_UUID(), FALSE, NULL, 3, 5, '   '),
        (GEN_RANDOM_UUID(), TRUE, NULL, 4, 10, 'alpha'),
        (GEN_RANDOM_UUID(), FALSE, ${7}, 5, NULL, 'beta')
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
  })

  test('rolls back successful isolated tests and shares the transaction with db.query', async () => {
    let schema = ''
    await withDatabase('rollback-success', async database => {
      schema = database.schema
      await database.sql`
        CREATE TABLE "NumberRow" (
          "id" UUID PRIMARY KEY,
          "value" DOUBLE PRECISION NOT NULL
        )
      `
      await database.sql`
        INSERT INTO "NumberRow" ("id", "value")
        VALUES
          (GEN_RANDOM_UUID(), ${1.5})
      `
      expect(await database.query<{ value: number }>('NumberRow', {
        fields: ['value'],
        limit: null,
      })).toEqual([{ value: 1.5 }])
    }, { fresh: true })

    const { database } = await useDatabaseFixture('rollback-success-check')
    expect(await database.sql<{ present: boolean }[]>`
      SELECT TO_REGCLASS(${`"${schema}"."NumberRow"`}) IS NOT NULL AS present
    `).toEqual([{ present: false }])
  })

  test('rolls back failed isolated tests', async () => {
    let schema = ''
    await expect(withDatabase('rollback-failure', async database => {
      schema = database.schema
      await database.sql`
        CREATE TABLE "FailureProbe" (
          "id" UUID PRIMARY KEY
        )
      `
      throw new Error('forced isolated failure')
    }, { fresh: true })).rejects.toThrow('forced isolated failure')

    const { database } = await useDatabaseFixture('rollback-failure-check')
    expect(await database.sql<{ present: boolean }[]>`
      SELECT TO_REGCLASS(${`"${schema}"."FailureProbe"`}) IS NOT NULL AS present
    `).toEqual([{ present: false }])
  })

  test('runs concurrent isolated tests in independent schemas', async () => {
    const schemas = await Promise.all([
      withDatabase('concurrent-a', async database => {
        await database.sql`
          CREATE TABLE "NumberRow" (
            "id" UUID PRIMARY KEY,
            "value" DOUBLE PRECISION NOT NULL
          )
        `
        await database.sql`
          INSERT INTO "NumberRow" ("id", "value")
          VALUES
            (GEN_RANDOM_UUID(), ${1})
        `
        expect(await database.query<{ value: number }>('NumberRow', {
          fields: ['value'],
          limit: null,
        })).toEqual([{ value: 1 }])
        return database.schema
      }, { fresh: true }),
      withDatabase('concurrent-b', async database => {
        await database.sql`
          CREATE TABLE "NumberRow" (
            "id" UUID PRIMARY KEY,
            "value" DOUBLE PRECISION NOT NULL
          )
        `
        await database.sql`
          INSERT INTO "NumberRow" ("id", "value")
          VALUES
            (GEN_RANDOM_UUID(), ${2})
        `
        expect(await database.query<{ value: number }>('NumberRow', {
          fields: ['value'],
          limit: null,
        })).toEqual([{ value: 2 }])
        return database.schema
      }, { fresh: true }),
    ])

    expect(new Set(schemas).size).toBe(2)
    const { database } = await useDatabaseFixture('concurrent-check')
    expect(await database.sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM pg_catalog.pg_namespace
      WHERE nspname IN (${schemas[0]}, ${schemas[1]})
    `).toEqual([{ count: 0 }])
  })

  test('cleans committed durable schemas after failures', async () => {
    let schema = ''
    await expect(withDatabase('durable-failure', async database => {
      schema = database.schema
      await database.tx(async sql => {
        await sql`
          CREATE TABLE "DurableFailure" (
            "id" UUID PRIMARY KEY
          )
        `
      })
      throw new Error('forced durable failure')
    }, { fresh: true })).rejects.toThrow('forced durable failure')

    const { database } = await useDatabaseFixture('durable-failure-check')
    expect(await database.sql<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = ${schema}) AS present
    `).toEqual([{ present: false }])
  })

  test.serial('leaves no isolated database schemas behind', async () => {
    const { database } = await useDatabaseFixture('schema-leak-check')
    expect(await database.sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM pg_catalog.pg_namespace
      WHERE nspname LIKE 'basis_test_%'
    `).toEqual([{ count: 0 }])
  })

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
  })
})
