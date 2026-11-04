import { describe, expect, test } from 'bun:test'
import { toMatchSQL } from '../testing/toMatchSQL'
import { compileEntityQuery } from './Database'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'
import { QueryNormalizer } from './QueryNormalizer'
import { SortDirection } from './SortDirection'
import { SQL } from './SQL'

expect.extend({ toMatchSQL })

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [{
    fields: [
      { field: 'id', format: 'UUID' },
      { field: 'active', type: 'Boolean' },
      { field: 'createdAt', type: 'Timestamp' },
      { field: 'dueOn', type: 'Date' },
      { field: 'externalId', type: 'Number' },
      { field: 'score', type: 'Number' },
      { field: 'title', type: 'String' },
    ],
    name: 'Note',
  }],
}))

const entity = 'Note'
const note = definitions.entity(entity)
if (!note) throw new Error('missing Note entity')

const snowflakeDefinitions = EntityDefinitions.load(JSON.stringify({
  entities: [{
    fields: [
      { field: 'id', format: 'Snowflake' },
      { field: 'externalId', type: 'Number' },
      { field: 'title', type: 'String' },
    ],
    name: 'Account',
  }],
}))

const hierarchyDefinitions = EntityDefinitions.load(JSON.stringify({
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
      fields: [{ field: 'permissions', type: 'String' }],
      name: 'SystemUser',
    },
    {
      extends: 'User',
      fields: [{ field: 'company', type: 'String' }],
      name: 'Client',
    },
  ],
}))

const graphDefinitions = EntityDefinitions.load(JSON.stringify({
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
        { column: 'managerId', field: 'manager', target: 'User', type: 'Entity' },
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
        { column: 'ownerId', field: 'owner', target: 'User', type: 'Entity' },
        { column: 'favoriteId', field: 'favorite', target: 'Entity', type: 'Entity' },
      ],
      name: 'Article',
    },
  ],
}))

const collectionDefinitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'id', format: 'UUID' },
        {
          field: 'tags',
          items: { type: 'String' },
          type: 'Array',
        },
        {
          field: 'articles',
          items: { target: 'Article', type: 'Entity' },
          mapping: { field: 'owner', kind: 'Inverse' },
          type: 'Collection',
        },
      ],
      name: 'Tagged',
    },
    {
      fields: [
        { field: 'id', format: 'Snowflake' },
        {
          column: 'ownerId',
          field: 'owner',
          target: 'Tagged',
          type: 'Entity',
        },
      ],
      name: 'Article',
    },
  ],
}))

const incompatibleDefinitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    { fields: [{ field: 'id', format: 'UUID' }], name: 'User' },
    { extends: 'User', fields: [{ field: 'permissions', type: 'String' }], name: 'SystemUser' },
    { extends: 'User', fields: [{ field: 'permissions', type: 'Number' }], name: 'Client' },
  ],
}))

describe('SQL.where', () => {
  test('compiles explicit And comparisons and preserves bound values', () => {
    const predicate = SQL.where(definitions, entity, {
      filters: [
        { field: 'score', operator: Operator.Comparison.GreaterThanOrEqual, value: 3 },
        { field: 'score', operator: Operator.Comparison.LessThan, value: 6 },
        { field: 'title', operator: Operator.Comparison.Equal, value: "x' OR true --" },
      ],
      operator: Operator.Logical.And,
    })

    expect(predicate.sql).toContain('COALESCE("score" >= $1, FALSE)')
    expect(predicate.sql).toContain('COALESCE("score" < $2, FALSE)')
    expect(predicate.sql).toContain('"title" IS NOT DISTINCT FROM $3')
    expect(predicate.sql.startsWith('WHERE (')).toBe(true)
    expect(predicate.values).toEqual([3, 6, "x' OR true --"])
  })

  test('compiles two-valued equality, ranges, Or, Not, Between, and Empty', () => {
    expect(SQL.where(definitions, entity, { score: 5 })).toEqual({
      sql: 'WHERE "score" IS NOT DISTINCT FROM $1',
      values: [5],
    })
    expect(SQL.where(definitions, entity, {
      field: 'score',
      operator: Operator.Comparison.GreaterThan,
      value: 5,
    })).toEqual({
      sql: 'WHERE COALESCE("score" > $1, FALSE)',
      values: [5],
    })
    expect(SQL.where(definitions, entity, {
      filters: [
        { field: 'score', operator: Operator.Comparison.Equal, value: 5 },
        { field: 'title', operator: Operator.Comparison.Equal, value: 'kept' },
      ],
      operator: Operator.Logical.Or,
    })).toEqual({
      sql: 'WHERE ("score" IS NOT DISTINCT FROM $1 OR "title" IS NOT DISTINCT FROM $2)',
      values: [5, 'kept'],
    })
    expect(SQL.where(definitions, entity, {
      filters: [{ field: 'score', operator: Operator.Comparison.Equal, value: 5 }],
      operator: Operator.Logical.Not,
    })).toEqual({
      sql: 'WHERE (NOT ("score" IS NOT DISTINCT FROM $1))',
      values: [5],
    })
    expect(SQL.where(definitions, entity, {
      field: 'score',
      operator: Operator.Comparison.NotEqual,
      value: 5,
    })).toEqual({
      sql: 'WHERE (NOT ("score" IS NOT DISTINCT FROM $1))',
      values: [5],
    })
    expect(SQL.where(definitions, entity, {
      field: 'score',
      operator: Operator.Comparison.NotEqual,
      value: null,
    })).toEqual({
      sql: 'WHERE (NOT ("score" IS NULL))',
      values: [],
    })
    expect(SQL.where(definitions, entity, {
      field: 'score',
      operator: Operator.Comparison.Between,
      values: [3, 6],
    })).toEqual({
      sql: 'WHERE (COALESCE("score" >= $1, FALSE) AND COALESCE("score" <= $2, FALSE))',
      values: [3, 6],
    })
    expect(SQL.where(definitions, entity, {
      field: 'title',
      operator: Operator.Comparison.Empty,
    })).toEqual({
      sql: 'WHERE ("title" IS NULL OR "title" IS NOT DISTINCT FROM $1)',
      values: [''],
    })
    expect(SQL.where(definitions, entity, {
      filters: [{
        field: 'title',
        operator: Operator.Comparison.Empty,
      }],
      operator: Operator.Logical.Not,
    })).toEqual({
      sql: 'WHERE (NOT (("title" IS NULL OR "title" IS NOT DISTINCT FROM $1)))',
      values: [''],
    })
  })

  test('preserves nested logical grouping', () => {
    const predicate = SQL.where(definitions, entity, {
      filters: [
        {
          filters: [
            { field: 'score', operator: Operator.Comparison.GreaterThan, value: 1 },
            { active: true },
          ],
          operator: Operator.Logical.And,
        },
        { title: 'Hello' },
      ],
      operator: Operator.Logical.And,
    })

    expect(predicate.sql.match(/AND/g)?.length).toBeGreaterThanOrEqual(2)
    expect(predicate.sql.startsWith('WHERE (')).toBe(true)
    expect(predicate.values).toEqual([1, true, 'Hello'])
  })

  test('compiles normalized string expressions to exact parameterized SQL', () => {
    const where = (source: string) => SQL.where(
      definitions,
      entity,
      QueryNormalizer.normalize(note, source),
    )

    expect(where('$not (score = 5 $or score = 10)')).toEqual({
      sql: 'WHERE (NOT (("score" IS NOT DISTINCT FROM $1 OR "score" IS NOT DISTINCT FROM $2)))',
      values: [5, 10],
    })
    expect(where('score $between [3, 6]')).toEqual({
      sql: 'WHERE (COALESCE("score" >= $1, FALSE) AND COALESCE("score" <= $2, FALSE))',
      values: [3, 6],
    })
    expect(where('title $empty')).toEqual({
      sql: 'WHERE ("title" IS NULL OR "title" IS NOT DISTINCT FROM $1)',
      values: [''],
    })
    expect(where('score != 5')).toEqual({
      sql: 'WHERE (NOT ("score" IS NOT DISTINCT FROM $1))',
      values: [5],
    })
    expect(where('score != null')).toEqual({
      sql: 'WHERE (NOT ("score" IS NULL))',
      values: [],
    })
  })

  test('maps null equality to IS NULL without binding', () => {
    expect(SQL.where(definitions, entity, { score: null })).toEqual({
      sql: 'WHERE "score" IS NULL',
      values: [],
    })
    expect(SQL.where(definitions, entity, {
      field: 'score',
      operator: Operator.Comparison.Equal,
      value: null,
    })).toEqual({ sql: 'WHERE "score" IS NULL', values: [] })
  })

  test('supports ranges only for ordered scalar field types', () => {
    for (const [field, value] of [
      ['createdAt', '2026-01-02T03:04:05.000Z'],
      ['dueOn', '2026-01-02'],
      ['externalId', 7],
      ['score', 3],
      ['title', 'Hello'],
    ] as const) {
      expect(() => SQL.where(definitions, entity, {
        field,
        operator: Operator.Comparison.GreaterThan,
        value,
      })).not.toThrow()
    }

    expect(() => SQL.where(definitions, entity, {
      field: 'active',
      operator: Operator.Comparison.GreaterThan,
      value: true,
    })).toThrow('is not valid for field "Note.active"')
    expect(SQL.where(definitions, entity, {
      field: 'id',
      operator: Operator.Comparison.GreaterThan,
      value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    })).toEqual({
      sql: 'WHERE COALESCE("id" > $1, FALSE)',
      values: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
    })
  })

  test('rejects null ranges and invalid scalar operands', () => {
    expect(() => SQL.where(definitions, entity, {
      field: 'score',
      operator: Operator.Comparison.GreaterThan,
      value: null,
    })).toThrow('must not be null')

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '3']) {
      expect(() => SQL.where(definitions, entity, { score: value })).toThrow('not a valid number value')
    }
    expect(() => SQL.where(definitions, entity, { active: 'true' })).toThrow('not a valid boolean value')
    expect(() => SQL.where(definitions, entity, { id: '' })).toThrow('not a valid id value')
    expect(() => SQL.where(definitions, entity, { id: '42' })).toThrow('not a valid id value')
    expect(() => SQL.where(definitions, entity, { externalId: '01' })).toThrow('not a valid number value')
    expect(() => SQL.where(definitions, entity, { dueOn: '' })).toThrow('not a valid date value')
    expect(() => SQL.where(definitions, entity, {
      createdAt: new Date('invalid'),
    })).toThrow('not a valid timestamp value')
  })

  test('does not parse an operator-looking equality value as syntax', () => {
    expect(() => SQL.where(definitions, entity, {
      score: { [Operator.Comparison.GreaterThanOrEqual]: 5 },
    })).toThrow('not a valid number value')
  })

  test('keeps text-backed Snowflake identity comparisons textual', () => {
    expect(SQL.where(snowflakeDefinitions, 'Account', { id: '2' })).toEqual({
      sql: 'WHERE "id" IS NOT DISTINCT FROM $1',
      values: ['2'],
    })
    expect(SQL.where(snowflakeDefinitions, 'Account', {
      field: 'id',
      operator: Operator.Comparison.GreaterThan,
      value: '2',
    })).toEqual({
      sql: 'WHERE COALESCE("id" > $1, FALSE)',
      values: ['2'],
    })
    expect(SQL.where(snowflakeDefinitions, 'Account', {
      field: 'externalId',
      operator: Operator.Comparison.GreaterThan,
      value: 2,
    })).toEqual({
      sql: 'WHERE COALESCE("externalId" > $1, FALSE)',
      values: [2],
    })
  })

  test('orders text-backed identity values by their text column', () => {
    expect(SQL.orderBy(snowflakeDefinitions, 'Account', 'id'))
      .toEqual({ sql: 'ORDER BY "id" ASC' })
    expect(SQL.orderBy(snowflakeDefinitions, 'Account', 'externalId'))
      .toEqual({ sql: 'ORDER BY "externalId" ASC' })
  })

  test('normalizes exact Snowflake identity bigint operands to canonical text', () => {
    expect(SQL.where(snowflakeDefinitions, 'Account', {
      id: 9223372036854775807n,
    }).values).toEqual(['9223372036854775807'])
    expect(SQL.where(snowflakeDefinitions, 'Account', {
      id: '9223372036854775807',
    }).values).toEqual(['9223372036854775807'])
  })

  test('compiles polymorphic abstract queries with root identity and descendants', () => {
    const compiled = compileEntityQuery(hierarchyDefinitions, 'User', {
      fields: ['id', 'name', 'entity', 'email'],
      limit: 10,
      orderBy: 'name',
      where: { field: 'name', operator: Operator.Comparison.Contains, value: 'Ada' },
    })

    expect(compiled.sql).toContain('FROM "User" "t"')
    expect(compiled.sql).toContain('JOIN "Entity" "r" ON "r"."id" = "t"."id"')
    expect(compiled.sql).toContain('r."entity" IN (\'SystemUser\', \'Client\')')
    expect(compiled.sql).toContain('r."name" ILIKE $1 ESCAPE')
    expect(compiled.sql).toContain('ORDER BY r."name" ASC, r."id" ASC')
    expect(compiled.values).toEqual(['%Ada%', 10, 0])
  })

  test('treats an empty abstract orderBy as stable default ordering', () => {
    const compiled = compileEntityQuery(hierarchyDefinitions, 'User', {
      fields: ['id'],
      orderBy: [],
    })
    expect(compiled.sql).toContain('ORDER BY r."name" ASC, r."id" ASC')
    expect(compiled.sql).not.toContain('ORDER BY ,')
  })

  test('projects nullable descendant-only fields for abstract leaves', () => {
    const compiled = compileEntityQuery(graphDefinitions, 'User', {
      fields: ['id', 'entity', 'permissions', 'status'],
    })
    expect(compiled.sql).toContain('LEFT JOIN "SystemUser"')
    expect(compiled.sql).toContain('LEFT JOIN "Client"')
    expect(compiled.sql).toContain('CASE WHEN r."entity" IN (\'SystemUser\')')
    expect(compiled.sql).toContain('"status"')
    expect(compiled.sql).toContain('"permissions"')
  })

  test('projects singular references and dotted paths with nested aliases', () => {
    const compiled = compileEntityQuery(graphDefinitions, 'Article', {
      fields: ['id', 'title', 'owner', 'owner.permissions', 'owner.manager.name'],
    })
    expect(compiled.sql).toContain('LEFT JOIN "User"')
    expect(compiled.sql).toContain('"owner__id"')
    expect(compiled.sql).toContain('"owner__permissions"')
    expect(compiled.sql).toContain('"owner__manager__v0__name"')
    expect(compiled.sql).not.toContain('"owner.permissions"')
    expect(compiled.values).toEqual([25, 0])
  })

  test('projects leaf-owned fields and references through the universal Entity root', () => {
    const compiled = compileEntityQuery(graphDefinitions, 'Article', {
      fields: ['favorite.name', 'favorite.permissions', 'favorite.owner.name'],
    })
    expect(compiled.sql).toContain('LEFT JOIN "Entity"')
    expect(compiled.sql).toContain('LEFT JOIN "SystemUser"')
    expect(compiled.sql).toContain('LEFT JOIN "Article"')
    expect(compiled.sql).toContain('"favorite__id"')
    expect(compiled.sql).toContain('"favorite__name"')
    expect(compiled.sql).toContain('"favorite__permissions"')
    expect(compiled.sql).toContain('"favorite__owner__v0__name"')
    expect(compiled.sql).not.toContain('"favorite.permissions"')
  })

  test('projects native scalar arrays and rejects relationship collections', () => {
    const compiled = compileEntityQuery(collectionDefinitions, 'Tagged', {
      fields: ['id', 'tags'],
    })
    expect(compiled.sql).toContain('t."tags" AS "tags"')
    expect(() => compileEntityQuery(collectionDefinitions, 'Tagged', {
      fields: ['articles'],
    })).toThrow('collection projections are not supported yet')
    expect(() => compileEntityQuery(collectionDefinitions, 'Tagged', {
      fields: ['id'],
      where: { tags: 'x' },
    })).toThrow('array fields cannot be used in predicates or ordering')
    expect(() => compileEntityQuery(collectionDefinitions, 'Tagged', {
      fields: ['id'],
      orderBy: 'tags',
    })).toThrow('array fields cannot be used in predicates or ordering')
  })

  test('rejects incompatible descendant-only declarations', () => {
    expect(() => compileEntityQuery(incompatibleDefinitions, 'User', {
      fields: ['permissions'],
    })).toThrow('has incompatible declarations')
  })

  test('rejects invalid dotted projection paths', () => {
    expect(() => compileEntityQuery(graphDefinitions, 'Article', {
      fields: ['title.value'],
    })).toThrow('Cannot traverse scalar field')
    expect(() => compileEntityQuery(graphDefinitions, 'Article', {
      fields: ['owner.missing'],
    })).toThrow('Unknown field "User.missing"')
    expect(() => compileEntityQuery(graphDefinitions, 'Article', {
      fields: ['owner.manager.manager.name'],
    })).toThrow('Repeated reference expansion')
  })

  test('compiles substring predicates and escapes wildcard characters', () => {
    expect(SQL.where(definitions, entity, {
      field: 'title',
      operator: Operator.Comparison.Contains,
      value: '50%_off\\',
    })).toEqual({
      sql: 'WHERE ("title" IS NOT NULL AND "title" ILIKE $1 ESCAPE \'\\\')',
      values: ['%50\\%\\_off\\\\%'],
    })
  })

  test('compiles a complete concrete query with ordered bindings', () => {
    const compiled = compileEntityQuery(definitions, entity, {
      fields: ['title', 'score'],
      limit: 7,
      offset: 3,
      orderBy: [
        { direction: SortDirection.Descending, field: 'score' },
        { direction: SortDirection.Ascending, field: 'title' },
      ],
      where: '$not (score = 5 $or score = 10)',
    })

    expect(compiled.sql).toMatchSQL(`
      SELECT t."title" AS "title", t."score" AS "score"
      FROM "Note" "t"
      WHERE (NOT ((
        t."score" IS NOT DISTINCT FROM $1 OR t."score" IS NOT DISTINCT FROM $2
      )))
      ORDER BY t."score" DESC, t."title" ASC
      LIMIT $3 OFFSET $4
    `)
    expect(compiled.values).toEqual([5, 10, 7, 3])
  })
})
