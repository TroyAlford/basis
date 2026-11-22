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
      { field: 'favoriteIds', items: { format: 'UUID', type: 'ID' }, type: 'Array' },
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

const collectionDefinitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'tags', items: { type: 'String' }, type: 'Array' },
        { field: 'payload', type: 'JSON' },
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
  ],
}))

const relationshipDefinitions = EntityDefinitions.load(JSON.stringify({
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
      { field: 'labels', items: { type: 'String' }, type: 'Array' },
    ],
    name: 'Membership',
  }],
}))

const nestedCollectionDefinitions = EntityDefinitions.load(JSON.stringify({
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

const reciprocalDefinitions = EntityDefinitions.load(JSON.stringify({
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
        { field: 'manager', target: 'Person', type: 'Entity' },
        { field: 'spouse', target: 'Person', type: 'Entity' },
        { field: 'child', target: 'Person', type: 'Entity' },
        { field: 'primaryCampaign', target: 'Campaign', type: 'Entity' },
      ],
      name: 'Person',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'owner', inverse: 'pets', target: 'Person', type: 'Entity' },
      ],
      name: 'Pet',
    },
    {
      fields: [
        { field: 'owner', target: 'Person', type: 'Entity' },
        { field: 'primaryCampaign', target: 'Campaign', type: 'Entity' },
      ],
      name: 'Campaign',
    },
  ],
}))

const oneDefinitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { cardinality: 'One', field: 'pet', inverse: 'owner', target: 'Pet', type: 'Inverse' },
      ],
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
      sql: 'WHERE (NOT COALESCE(("score" IS NOT DISTINCT FROM $1), FALSE))',
      values: [5],
    })
    expect(SQL.where(definitions, entity, {
      field: 'score',
      operator: Operator.Comparison.NotEqual,
      value: 5,
    })).toEqual({
      sql: 'WHERE (NOT COALESCE(("score" IS NOT DISTINCT FROM $1), FALSE))',
      values: [5],
    })
    expect(SQL.where(definitions, entity, {
      field: 'score',
      operator: Operator.Comparison.NotEqual,
      value: null,
    })).toEqual({
      sql: 'WHERE (NOT COALESCE(("score" IS NULL), FALSE))',
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
      sql: 'WHERE (NOT COALESCE((("title" IS NULL OR "title" IS NOT DISTINCT FROM $1)), FALSE))',
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
      sql: 'WHERE (NOT COALESCE((("score" IS NOT DISTINCT FROM $1 OR "score" IS NOT DISTINCT FROM $2)), FALSE))',
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
      sql: 'WHERE (NOT COALESCE(("score" IS NOT DISTINCT FROM $1), FALSE))',
      values: [5],
    })
    expect(where('score != null')).toEqual({
      sql: 'WHERE (NOT COALESCE(("score" IS NULL), FALSE))',
      values: [],
    })
  })

  test('compiles scalar $in lists to ordered parameter placeholders', () => {
    expect(SQL.where(definitions, entity, {
      field: 'title',
      operator: Operator.Comparison.In,
      value: ['A', 'B'],
    })).toEqual({
      sql: 'WHERE "title" IN ($1, $2)',
      values: ['A', 'B'],
    })
    expect(SQL.where(definitions, entity, {
      filters: [
        { field: 'title', operator: Operator.Comparison.Equal, value: 'prefix' },
        { field: 'title', operator: Operator.Comparison.In, value: ['A', 'B'] },
      ],
      operator: Operator.Logical.And,
    })).toEqual({
      sql: 'WHERE ("title" IS NOT DISTINCT FROM $1 AND "title" IN ($2, $3))',
      values: ['prefix', 'A', 'B'],
    })
    const identity = '00000000-0000-4000-8000-000000000001'
    expect(SQL.where(definitions, entity, {
      field: 'id',
      operator: Operator.Comparison.In,
      value: [identity],
    })).toEqual({
      sql: 'WHERE "id" IN ($1)',
      values: [identity],
    })
    const source = QueryNormalizer.normalize(note, "title $in ['A', 'B']")
    expect(SQL.where(definitions, entity, source)).toEqual({
      sql: 'WHERE "title" IN ($1, $2)',
      values: ['A', 'B'],
    })
    expect(SQL.where(definitions, entity, {
      field: 'score',
      operator: Operator.Comparison.In,
      value: [10, 20, 30],
    })).toEqual({
      sql: 'WHERE "score" IN ($1, $2, $3)',
      values: [10, 20, 30],
    })
    expect(SQL.where(definitions, entity, {
      field: 'active',
      operator: Operator.Comparison.In,
      value: [true, false],
    })).toEqual({
      sql: 'WHERE "active" IN ($1, $2)',
      values: [true, false],
    })
    expect(SQL.where(definitions, entity, {
      field: 'dueOn',
      operator: Operator.Comparison.In,
      value: ['2026-01-02', '2026-01-03'],
    })).toEqual({
      sql: 'WHERE "dueOn" IN ($1, $2)',
      values: ['2026-01-02', '2026-01-03'],
    })
    expect(SQL.where(definitions, entity, {
      field: 'createdAt',
      operator: Operator.Comparison.In,
      value: ['2026-01-02T03:04:05.000Z'],
    })).toEqual({
      sql: 'WHERE "createdAt" IN ($1)',
      values: ['2026-01-02T03:04:05.000Z'],
    })
  })

  test('compiles field-backed array containment through the existing array path', () => {
    expect(SQL.where(definitions, entity, {
      field: 'favoriteIds',
      operator: Operator.Comparison.Contains,
      value: { $field: 'id' },
    })).toEqual({
      sql: 'WHERE "favoriteIds" @> ARRAY["id"::text]',
      values: [],
    })
    expect(SQL.where(definitions, entity, {
      field: 'favoriteIds',
      operator: Operator.Comparison.Contains,
      value: '$me',
    })).toEqual({
      sql: 'WHERE "favoriteIds" @> ARRAY[nullif(current_setting(\'actor.id\', true), \'\')::text]',
      values: [],
    })
  })

  test('rejects invalid scalar $in operands before emitting SQL', () => {
    expect(() => SQL.where(definitions, entity, {
      field: 'title',
      operator: Operator.Comparison.In,
      value: [],
    })).toThrow('non-empty')
    expect(() => SQL.where(definitions, entity, {
      field: 'title',
      operator: Operator.Comparison.In,
      value: ['A', null],
    })).toThrow('cannot contain null')
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
    })).toThrow('is not valid for field "active"')
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
    expect(compiled.sql).toContain('LEFT JOIN ("User"')
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

  test('projects native scalar arrays and collection envelopes', () => {
    const compiled = compileEntityQuery(collectionDefinitions, 'Pet', {
      fields: ['id', 'tags', 'payload', 'visits{$limit:2,$offset:1}'],
    })
    expect(compiled.sql).toContain('t."tags" AS "tags"')
    expect(compiled.sql).toContain('t."payload" AS "payload"')
    expect(compiled.sql).toContain('"visits"')
    expect(compiled.sql).toContain('"visits__matched"')
    expect(compiled.sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+/u)
    expect(compiled.values).toEqual([2, 1, 25, 0])
    expect(() => compileEntityQuery(collectionDefinitions, 'Pet', {
      fields: ['id'],
      where: { tags: 'x' },
    })).toThrow('requires an array operand')
    expect(() => compileEntityQuery(collectionDefinitions, 'Pet', {
      fields: ['id'],
      orderBy: 'tags',
    })).toThrow('cannot be used in ordering')
    expect(() => compileEntityQuery(collectionDefinitions, 'Pet', {
      fields: ['id'],
      where: { payload: 'x' },
    })).toThrow('not valid for field "payload"')
    expect(() => compileEntityQuery(collectionDefinitions, 'Pet', {
      fields: ['id'],
      orderBy: 'payload',
    })).toThrow('cannot be used in ordering')
  })

  test('projects relationship-backed collection previews', () => {
    const members = compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', 'members{$limit:2,$offset:1}'],
    })
    expect(members.sql).toContain('FROM "Campaign" "t"')
    expect(members.sql).toMatch(/"Membership" "cj\d+"/)
    expect(members.sql).toMatch(/"cj\d+"\."campaign\.id" = "t"\."id"/)
    expect(members.sql).toMatch(/"cj\d+"\."user\.id"/)
    expect(members.sql).toContain('"members"')
    expect(members.values).toEqual([2, 1, 25, 0])

    const articles = compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id', 'articles{$limit:1}'],
    })
    expect(articles.sql).toMatch(/"Article" "ct\d+"/)
    expect(articles.sql).toMatch(/"ct\d+"\."author\.id" = "t"\."id"/)
    expect(articles.sql).not.toContain('"Membership"')
  })

  test('projects collection paths as nested arrays with flattened relationship properties', () => {
    const compiled = compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', 'name', 'members', 'members.name', 'members.role'],
    })
    expect(compiled.sql).toContain('json_agg')
    expect(compiled.sql).toContain('row_to_json')
    expect(compiled.sql).toContain('"members"')
    expect(compiled.sql).toContain("'role'")
    expect(compiled.sql).not.toContain('"members__items"')
  })

  test('caps projected collections, reports totals and applies collection filters', () => {
    const defaults = compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', 'members', 'members.name'],
    })
    expect(defaults.sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+/u)
    expect(defaults.values).toContain(3)
    expect(defaults.sql).toContain('__matched')

    const capped = compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', 'members{$limit:50}', 'members.name'],
    })
    expect(capped.values).toContain(50)

    const filtered = compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', "members[name != 'Ada']{$limit:null}", 'members.name'],
    })
    expect(filtered.sql).not.toContain('LIMIT 3')
    expect(filtered.values).toContain('Ada')
    expect(filtered.sql).toContain('__matched')
    expect(filtered.sql).toContain('__total')
  })

  test('enforces collection directive placement and duplicate rules', () => {
    expect(() => compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', "members{$limit:1}[name != 'Ada']"],
    })).toThrow('Collection options must precede filters')
    expect(() => compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', "members[name != 'Ada'].name"],
    })).toThrow('Collection directives must end the path')
    expect(() => compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', 'members{$limit:1}', 'members{$offset:1}'],
    })).toThrow('more than one directive path')
    expect(() => compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', 'members{$limit:1,$limit:2}'],
    })).toThrow('repeated')
    expect(() => compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', 'members{$offset:1,$offset:2}'],
    })).toThrow('repeated')
    expect(() => compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', 'members{$orderBy:name,$orderBy:-name}'],
    })).toThrow('repeated')
  })

  test('filters and projects relationship-owned scalar fields by flattened path', () => {
    const compiled = compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', "members[role = 'GM']", 'members.name', 'members.role'],
    })
    expect(compiled.sql).toMatch(/"cj\d+"\."role"\s*\)\s+FROM\s+"Membership"/u)
    expect(compiled.sql).toContain('"Membership"')
    expect(compiled.sql).toContain("json_build_object( 'role'")
    expect(compiled.values).toContain('GM')
  })

  test('rejects ambiguous target and relationship field names', () => {
    const ambiguousDefinitions = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'role', type: 'String' },
          ],
          name: 'User',
        },
        { fields: [{ field: 'id', format: 'UUID' }], name: 'Campaign' },
      ],
      relationships: [{
        between: [
          { field: 'user', inverse: 'campaigns', target: 'User' },
          { field: 'campaign', inverse: 'members', target: 'Campaign' },
        ],
        fields: [{ field: 'role', type: 'String' }],
        name: 'Membership',
      }],
    }))
    expect(() => compileEntityQuery(ambiguousDefinitions, 'Campaign', {
      fields: ['id', 'members.role'],
    })).toThrow('Ambiguous collection field "members.role"')
    expect(() => compileEntityQuery(ambiguousDefinitions, 'Campaign', {
      fields: ['id', "members[role = 'GM']"],
    })).toThrow('Ambiguous collection field "role"')
  })

  test('guarantees requested collection ordering with an identity tie-break', () => {
    const compiled = compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id', 'members{$limit:2,$orderBy:-name}'],
    })
    expect(compiled.sql).toContain('json_agg(')
    expect(compiled.sql).toMatch(/ORDER BY\s+"__item"\."name" DESC,\s+"__item"\."id" ASC/u)
    expect(compiled.sql).toMatch(/ORDER BY\s+"__member"\."name" DESC,\s+"__member"\."id" ASC/u)
  })

  test('accepts root orderBy shorthand', () => {
    const compiled = compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      orderBy: ['name', '-id'],
    })
    expect(compiled.sql).toContain('ORDER BY r."name" ASC, t."id" DESC')
  })

  test('projects multi-level collection paths', () => {
    const compiled = compileEntityQuery(nestedCollectionDefinitions, 'User', {
      fields: ['id', 'pets', 'pets.toys', 'pets.toys.label'],
    })
    expect(compiled.sql.match(/LEFT JOIN LATERAL/gu)?.length).toBeGreaterThanOrEqual(2)
    expect(compiled.sql).toContain('"toys"')
    expect(compiled.sql).toContain('"pets"')
  })

  test('rejects incompatible descendant-only declarations at construction', () => {
    expect(() => EntityDefinitions.load(JSON.stringify({
      entities: [
        { fields: [{ field: 'id', format: 'UUID' }], name: 'User' },
        { extends: 'User', fields: [{ field: 'permissions', type: 'String' }], name: 'SystemUser' },
        { extends: 'User', fields: [{ field: 'permissions', type: 'Number' }], name: 'Client' },
      ],
    }))).toThrow('incompatible field contract "permissions" in hierarchy "User"')
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
    })).not.toThrow()
  })

  test('validates graph budgets, repeated edges and collection boundaries', () => {
    expect(() => compileEntityQuery(definitions, entity, {
      fields: Array.from({ length: 65 }, () => 'id'),
    })).toThrow('maximum path count')
    expect(() => compileEntityQuery(definitions, entity, {
      fields: Array.from({ length: 64 }, () => 'a.b.c'),
    })).toThrow('maximum graph work budget')
    const edgeDefinitions = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'link', target: 'Middle', type: 'Entity' },
          ],
          name: 'Root',
        },
        {
          fields: [
            { field: 'link', target: 'Root', type: 'Entity' },
          ],
          name: 'Middle',
        },
      ],
    }))
    expect(() => compileEntityQuery(edgeDefinitions, 'Root', {
      fields: ['link.link'],
    })).not.toThrow()
    expect(() => compileEntityQuery(edgeDefinitions, 'Root', {
      fields: ['link.link.link'],
    })).not.toThrow()

    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id', 'articles.author'],
    })).toThrow('Reciprocal reference backtracking')
    const fanoutDefinitions = EntityDefinitions.load(JSON.stringify({
      entities: [
        { fields: [{ field: 'entry', target: 'Entity', type: 'Entity' }], name: 'Start' },
        ...['x', 'y', 'z', 'w'].flatMap(field => (
          Array.from({ length: 4 }, (_, index) => ({
            fields: [{ field, target: 'Entity', type: 'Entity' }],
            name: `${field.toUpperCase()}${index}`,
          }))
        )),
      ],
    }))
    expect(() => compileEntityQuery(fanoutDefinitions, 'Start', {
      fields: ['entry.x.y.z.w.name'],
    })).toThrow('maximum graph work budget')
    expect(() => compileEntityQuery(fanoutDefinitions, 'Start', {
      fields: ['entry.x.name'],
    })).not.toThrow()

    const deepDefinitions = EntityDefinitions.load(JSON.stringify({
      entities: Array.from({ length: 10 }, (_, index) => ({
        fields: index === 9 ? [] : [{ field: 'next', target: `Node${index + 1}`, type: 'Entity' }],
        name: `Node${index}`,
      })),
    }))
    expect(() => compileEntityQuery(deepDefinitions, 'Node0', {
      fields: [Array.from({ length: 9 }, () => 'next').join('.')],
    })).toThrow('exceeds the maximum depth')
  })

  test('validates reciprocal One/Many traversal without banning repeated forward refs', () => {
    expect(() => compileEntityQuery(reciprocalDefinitions, 'Person', {
      fields: ['id', 'pets{$limit:2}'],
    })).not.toThrow()
    expect(() => compileEntityQuery(reciprocalDefinitions, 'Pet', {
      fields: ['id', 'owner.pets{$limit:2}'],
    })).not.toThrow()
    expect(() => compileEntityQuery(oneDefinitions, 'Person', {
      fields: ['id', 'pet'],
    })).not.toThrow()

    expect(() => compileEntityQuery(reciprocalDefinitions, 'Person', {
      fields: ['id', 'pets.owner'],
    })).toThrow('Reciprocal reference backtracking')
    expect(() => compileEntityQuery(reciprocalDefinitions, 'Pet', {
      fields: ['id', 'owner.pets.owner'],
    })).toThrow('Reciprocal reference backtracking')
    expect(() => compileEntityQuery(oneDefinitions, 'Pet', {
      fields: ['id', 'owner.pet'],
    })).toThrow('Reciprocal reference backtracking')
    expect(() => compileEntityQuery(oneDefinitions, 'Person', {
      fields: ['id', 'pet.owner'],
    })).toThrow('Reciprocal reference backtracking')

    expect(() => compileEntityQuery(reciprocalDefinitions, 'Person', {
      fields: ['id', 'manager.manager'],
    })).not.toThrow()
    expect(() => compileEntityQuery(reciprocalDefinitions, 'Person', {
      fields: ['id', 'spouse.child'],
    })).not.toThrow()
    expect(() => compileEntityQuery(reciprocalDefinitions, 'Campaign', {
      fields: ['id', 'owner.primaryCampaign'],
    })).not.toThrow()
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
      WHERE (NOT COALESCE(((
        t."score" IS NOT DISTINCT FROM $1 OR t."score" IS NOT DISTINCT FROM $2
      )), FALSE))
      ORDER BY t."score" DESC, t."title" ASC
      LIMIT $3 OFFSET $4
    `)
    expect(compiled.values).toEqual([5, 10, 7, 3])
  })

  test('compiles actor-presence and field-reference predicates', () => {
    const actor = QueryNormalizer.normalize(note, '$me != null')
    expect(SQL.where(definitions, entity, actor)).toEqual({
      sql: 'WHERE (NOT COALESCE((nullif(current_setting(\'actor.id\', true), \'\') IS NULL), FALSE))',
      values: [],
    })
    expect(SQL.where(definitions, entity, QueryNormalizer.normalize(note, '$me = null')).sql)
      .toBe('WHERE nullif(current_setting(\'actor.id\', true), \'\') IS NULL')

    const documents = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'owner', type: 'String' },
            { field: 'revision', target: 'Revision', type: 'Entity' },
          ],
          name: 'Document',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'owner', type: 'String' },
          ],
          name: 'Revision',
        },
      ],
    }))
    const document = documents.entity('Document')
    if (!document) throw new Error('missing Document entity')
    const compiled = compileEntityQuery(documents, 'Document', {
      fields: ['id'],
      limit: null,
      where: QueryNormalizer.normalize(document, 'owner = revision.owner'),
    })
    expect(compiled.sql).toContain('t."owner" IS NOT DISTINCT FROM b1."owner"')
  })
})
