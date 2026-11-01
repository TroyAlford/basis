import { describe, expect, test } from 'bun:test'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'
import { QueryNormalizer } from './QueryNormalizer'
import { SQL } from './SQL'

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [{
    fields: [
      { name: 'id', primaryKey: true, type: 'uuid' },
      { name: 'active', type: 'boolean' },
      { name: 'createdAt', type: 'timestamp' },
      { name: 'dueOn', type: 'date' },
      { name: 'externalId', type: 'snowflake' },
      { name: 'score', type: 'number' },
      { name: 'title', type: 'string' },
    ],
    name: 'Note',
  }],
}))

const entity = 'Note'
const note = definitions.entity(entity)
if (!note) throw new Error('missing Note entity')

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
      ['externalId', '9223372036854775807'],
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
    expect(() => SQL.where(definitions, entity, {
      field: 'id',
      operator: Operator.Comparison.GreaterThan,
      value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    })).toThrow('is not valid for field "Note.id"')
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
    expect(() => SQL.where(definitions, entity, { id: '' })).toThrow('not a valid uuid value')
    expect(() => SQL.where(definitions, entity, { dueOn: '' })).toThrow('not a valid date value')
    expect(() => SQL.where(definitions, entity, {
      createdAt: new Date('invalid'),
    })).toThrow('not a valid timestamp value')
    expect(() => SQL.where(definitions, entity, { externalId: 9e18 })).toThrow('not a valid snowflake value')
    expect(() => SQL.where(definitions, entity, { externalId: '9223372036854775808' }))
      .toThrow('not a valid snowflake value')
  })

  test('does not parse an operator-looking equality value as syntax', () => {
    expect(() => SQL.where(definitions, entity, {
      score: { [Operator.Comparison.GreaterThanOrEqual]: 5 },
    })).toThrow('not a valid number value')
  })

  test('accepts exact Snowflake bigint and decimal-string values', () => {
    expect(SQL.where(definitions, entity, {
      externalId: 9223372036854775807n,
    }).values).toEqual([9223372036854775807n])
    expect(SQL.where(definitions, entity, {
      externalId: '9223372036854775807',
    }).values).toEqual(['9223372036854775807'])
  })
})
