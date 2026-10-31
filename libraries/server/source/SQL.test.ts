import { describe, expect, test } from 'bun:test'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'
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

describe('SQL.where', () => {
  test('normalizes structured comparisons and preserves bound values', () => {
    const predicate = SQL.where(definitions, entity, {
      score: {
        [Operator.Comparison.GreaterThanOrEqual]: 3,
        [Operator.Comparison.LessThan]: 6,
      },
      title: "x' OR true --",
    })

    expect(predicate.sql).toContain('"score" >= $1')
    expect(predicate.sql).toContain('"score" < $2')
    expect(predicate.sql).toContain('"title" = $3')
    expect(predicate.sql.startsWith('WHERE (')).toBe(true)
    expect(predicate.values).toEqual([3, 6, "x' OR true --"])
  })

  test('preserves nested logical grouping', () => {
    const predicate = SQL.where(definitions, entity, {
      [Operator.Logical.And]: [
        { [Operator.Logical.And]: [{ score: { [Operator.Comparison.GreaterThan]: 1 } }, { active: true }] },
        { title: 'Hello' },
      ],
    })

    expect(predicate.sql.match(/AND/g)?.length).toBeGreaterThanOrEqual(2)
    expect(predicate.sql.startsWith('WHERE (')).toBe(true)
    expect(predicate.values).toEqual([1, true, 'Hello'])
  })

  test('maps null equality to IS NULL without binding', () => {
    expect(SQL.where(definitions, entity, { score: null })).toEqual({
      sql: 'WHERE "score" IS NULL',
      values: [],
    })
    expect(SQL.where(definitions, entity, {
      score: { [Operator.Comparison.Equal]: null },
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
        [field]: { [Operator.Comparison.GreaterThan]: value },
      })).not.toThrow()
    }

    expect(() => SQL.where(definitions, entity, {
      active: { [Operator.Comparison.GreaterThan]: true },
    })).toThrow('is not valid for field "Note.active"')
    expect(() => SQL.where(definitions, entity, {
      id: { [Operator.Comparison.GreaterThan]: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
    })).toThrow('is not valid for field "Note.id"')
  })

  test('rejects null ranges and invalid scalar operands', () => {
    expect(() => SQL.where(definitions, entity, {
      score: { [Operator.Comparison.GreaterThan]: null },
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
    expect(() => SQL.where(definitions, entity, { externalId: 9e18 }))
      .toThrow('not a valid snowflake value')
    expect(() => SQL.where(definitions, entity, { externalId: '9223372036854775808' }))
      .toThrow('not a valid snowflake value')
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
