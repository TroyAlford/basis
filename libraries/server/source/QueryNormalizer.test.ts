import { describe, expect, test } from 'bun:test'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'
import { Predicate } from './Predicate'
import { QueryNormalizer } from './QueryNormalizer'

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

const entity = definitions.entity('Note')
if (!entity) throw new Error('missing Note entity')

describe('QueryNormalizer', () => {
  test('normalizes string And comparisons identically to structured JSON', () => {
    expect(QueryNormalizer.normalize(entity, 'score >= 5 $and score < 10')).toEqual(
      Predicate.normalize(entity, {
        filters: [
          { field: 'score', operator: Operator.Comparison.GreaterThanOrEqual, value: 5 },
          { field: 'score', operator: Operator.Comparison.LessThan, value: 10 },
        ],
        operator: Operator.Logical.And,
      }),
    )
  })

  test('normalizes NotEqual identically to structured JSON', () => {
    expect(QueryNormalizer.normalize(entity, 'score != 5')).toEqual(
      Predicate.normalize(entity, {
        field: 'score',
        operator: Operator.Comparison.NotEqual,
        value: 5,
      }),
    )
    expect(QueryNormalizer.normalize(entity, 'score != null')).toEqual(
      Predicate.normalize(entity, {
        field: 'score',
        operator: Operator.Comparison.NotEqual,
        value: null,
      }),
    )
  })

  test('normalizes Between identically to structured JSON', () => {
    expect(QueryNormalizer.normalize(entity, 'score $between [5, 10]')).toEqual(
      Predicate.normalize(entity, {
        field: 'score',
        operator: Operator.Comparison.Between,
        values: [5, 10],
      }),
    )
    expect(QueryNormalizer.normalize(entity, 'score $between [5, null]')).toEqual(
      Predicate.normalize(entity, {
        field: 'score',
        operator: Operator.Comparison.Between,
        values: [5, null],
      }),
    )
    expect(QueryNormalizer.normalize(entity, 'externalId $between [9223372036854775807, null]')).toEqual(
      Predicate.normalize(entity, {
        field: 'externalId',
        operator: Operator.Comparison.Between,
        values: ['9223372036854775807', null],
      }),
    )
  })

  test('normalizes Empty and Not Empty identically to structured JSON', () => {
    expect(QueryNormalizer.normalize(entity, 'title $empty')).toEqual(
      Predicate.normalize(entity, {
        field: 'title',
        operator: Operator.Comparison.Empty,
      }),
    )
    expect(QueryNormalizer.normalize(entity, 'title !$empty')).toEqual(
      Predicate.normalize(entity, {
        filters: [{
          field: 'title',
          operator: Operator.Comparison.Empty,
        }],
        operator: Operator.Logical.Not,
      }),
    )
  })

  test('normalizes grouping, Or, and negation identically to structured JSON', () => {
    expect(QueryNormalizer.normalize(entity, '$not (score = 5 $or title = "kept")')).toEqual(
      Predicate.normalize(entity, {
        filters: [{
          filters: [
            { field: 'score', operator: Operator.Comparison.Equal, value: 5 },
            { field: 'title', operator: Operator.Comparison.Equal, value: 'kept' },
          ],
          operator: Operator.Logical.Or,
        }],
        operator: Operator.Logical.Not,
      }),
    )
    expect(QueryNormalizer.normalize(entity, 'score = 1 $or score = 2 $and active = true')).toEqual(
      Predicate.normalize(entity, {
        filters: [
          { field: 'score', operator: Operator.Comparison.Equal, value: 1 },
          {
            filters: [
              { field: 'score', operator: Operator.Comparison.Equal, value: 2 },
              { field: 'active', operator: Operator.Comparison.Equal, value: true },
            ],
            operator: Operator.Logical.And,
          },
        ],
        operator: Operator.Logical.Or,
      }),
    )
  })

  test('types literals from the target field', () => {
    expect(QueryNormalizer.normalize(entity, 'score = 5')).toEqual({
      field: 'score',
      operator: Operator.Comparison.Equal,
      value: 5,
    })
    expect(QueryNormalizer.normalize(entity, 'title = "5"')).toEqual({
      field: 'title',
      operator: Operator.Comparison.Equal,
      value: '5',
    })
    expect(QueryNormalizer.normalize(entity, 'externalId = 9223372036854775807')).toEqual({
      field: 'externalId',
      operator: Operator.Comparison.Equal,
      value: '9223372036854775807',
    })
    expect(QueryNormalizer.normalize(entity, 'active = true')).toEqual({
      field: 'active',
      operator: Operator.Comparison.Equal,
      value: true,
    })
    expect(QueryNormalizer.normalize(entity, 'dueOn = "2026-01-02"')).toEqual({
      field: 'dueOn',
      operator: Operator.Comparison.Equal,
      value: '2026-01-02',
    })
    expect(QueryNormalizer.normalize(entity, 'score = null')).toEqual({
      field: 'score',
      operator: Operator.Comparison.Equal,
      value: null,
    })
  })

  test('returns null for empty source', () => {
    expect(QueryNormalizer.normalize(entity, '')).toBeNull()
    expect(QueryNormalizer.normalize(entity, '   ')).toBeNull()
  })

  test('rejects parse errors before normalization', () => {
    expect(() => QueryNormalizer.normalize(entity, 'title = "unterminated'))
      .toThrow('Invalid where query at 8: Unterminated string literal')
    expect(() => QueryNormalizer.normalize(entity, 'score $between [null, null]'))
      .toThrow('Invalid where query at 26: Between requires at least one non-null bound')
  })

  test('rejects unknown fields and mismatched literal types', () => {
    expect(() => QueryNormalizer.normalize(entity, 'missing = 1'))
      .toThrow('Unknown field "Note.missing"')
    expect(() => QueryNormalizer.normalize(entity, 'score = "5"'))
      .toThrow('Query operand for "score" is not a valid number value')
    expect(() => QueryNormalizer.normalize(entity, 'title = 5'))
      .toThrow('Query operand for "title" is not a valid string value')
    expect(() => QueryNormalizer.normalize(entity, 'score $empty'))
      .toThrow('Query operator "$empty" is not valid for field "Note.score"')
  })
})
