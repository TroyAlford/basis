import { describe, expect, test } from 'bun:test'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'
import type { ComparisonFilter, Filter, LogicalFilter } from './Predicate'
import { Predicate } from './Predicate'

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [{
    fields: [
      { name: 'id', primaryKey: true, type: 'uuid' },
      { name: 'active', type: 'boolean' },
      { name: 'createdAt', type: 'timestamp' },
      { name: 'operator', type: 'string' },
      { name: 'score', type: 'number' },
      { name: 'title', type: 'string' },
    ],
    name: 'Note',
  }],
}))

const entity = definitions.entity('Note')
if (!entity) throw new Error('missing Note entity')

/**
 * Normalize where input for the test entity.
 * @param input - Filter input.
 * @returns The normalized filter.
 */
function normalize(input: Readonly<Record<string, unknown>>): Filter | null {
  return Predicate.normalize(entity, input)
}

/**
 * Require a logical filter.
 * @param filter - Filter candidate.
 * @returns The logical filter.
 */
function logical(filter: Filter | null): LogicalFilter {
  if (!filter || !('filters' in filter)) throw new Error('expected logical filter')
  return filter
}

/**
 * Require a comparison filter.
 * @param filter - Filter candidate.
 * @returns The comparison filter.
 */
function comparison(filter: Filter): ComparisonFilter {
  if ('filters' in filter) throw new Error('expected comparison filter')
  return filter
}

describe('Predicate.normalize', () => {
  test('turns single-field shorthand into an Equal comparison', () => {
    expect(normalize({ score: 5 })).toEqual({
      field: 'score',
      operator: Operator.Comparison.Equal,
      value: 5,
    })
  })

  test('normalizes an explicit comparison node', () => {
    expect(normalize({
      field: 'score',
      operator: Operator.Comparison.GreaterThanOrEqual,
      value: 5,
    })).toEqual({
      field: 'score',
      operator: Operator.Comparison.GreaterThanOrEqual,
      value: 5,
    })
  })

  test('preserves explicit And filters and their order', () => {
    const filter = logical(normalize({
      filters: [
        { field: 'score', operator: Operator.Comparison.GreaterThanOrEqual, value: 5 },
        { field: 'score', operator: Operator.Comparison.LessThan, value: 10 },
      ],
      operator: Operator.Logical.And,
    }))

    expect(filter.operator).toBe(Operator.Logical.And)
    expect(filter.filters.map(child => comparison(child).operator)).toEqual([
      Operator.Comparison.GreaterThanOrEqual,
      Operator.Comparison.LessThan,
    ])
  })

  test('preserves nested And groups', () => {
    const filter = logical(normalize({
      filters: [
        {
          filters: [{ score: 1 }, { title: 'nested' }],
          operator: Operator.Logical.And,
        },
        { active: true },
      ],
      operator: Operator.Logical.And,
    }))

    expect(filter.filters[0] && 'filters' in filter.filters[0]).toBe(true)
    expect(logical(filter.filters[0] ?? null).filters).toHaveLength(2)
  })

  test('allows shorthand leaves inside explicit And filters', () => {
    expect(normalize({
      filters: [{ score: 5 }, { title: 'Hello' }],
      operator: Operator.Logical.And,
    })).toEqual({
      filters: [
        { field: 'score', operator: Operator.Comparison.Equal, value: 5 },
        { field: 'title', operator: Operator.Comparison.Equal, value: 'Hello' },
      ],
      operator: Operator.Logical.And,
    })
  })

  test('uses null equality without inspecting the value', () => {
    expect(normalize({ score: null })).toEqual({
      field: 'score',
      operator: Operator.Comparison.Equal,
      value: null,
    })
  })

  test('treats Date values as scalar equality operands', () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z')
    expect(normalize({ createdAt })).toEqual({
      field: 'createdAt',
      operator: Operator.Comparison.Equal,
      value: createdAt,
    })
  })

  test('does not reinterpret an operator-looking object as comparison syntax', () => {
    const value = { [Operator.Comparison.GreaterThanOrEqual]: 5 }
    expect(normalize({ score: value })).toEqual({
      field: 'score',
      operator: Operator.Comparison.Equal,
      value,
    })
  })

  test('supports a field named operator through the explicit form', () => {
    expect(normalize({
      field: 'operator',
      operator: Operator.Comparison.Equal,
      value: 'and',
    })).toEqual({
      field: 'operator',
      operator: Operator.Comparison.Equal,
      value: 'and',
    })
  })

  test('returns null for an empty where expression', () => {
    expect(normalize({})).toBeNull()
  })

  test('rejects multiple shorthand fields instead of implying And', () => {
    expect(() => normalize({ score: 1, title: 'Hello' })).toThrow(
      'Query shorthand must contain exactly one field; use Operator.Logical.And with filters for multiple conditions',
    )
  })

  test('normalizes NotEqual into Not(Equal)', () => {
    expect(normalize({ field: 'score', operator: Operator.Comparison.NotEqual, value: 5 })).toEqual({
      filters: [{ field: 'score', operator: Operator.Comparison.Equal, value: 5 }],
      operator: Operator.Logical.Not,
    })
    expect(normalize({ field: 'score', operator: Operator.Comparison.NotEqual, value: null })).toEqual({
      filters: [{ field: 'score', operator: Operator.Comparison.Equal, value: null }],
      operator: Operator.Logical.Not,
    })
  })

  test('normalizes Between into an inclusive And range', () => {
    expect(normalize({
      field: 'score',
      operator: Operator.Comparison.Between,
      values: [3, 6],
    })).toEqual({
      filters: [
        { field: 'score', operator: Operator.Comparison.GreaterThanOrEqual, value: 3 },
        { field: 'score', operator: Operator.Comparison.LessThanOrEqual, value: 6 },
      ],
      operator: Operator.Logical.And,
    })
    expect(normalize({
      field: 'score',
      operator: Operator.Comparison.Between,
      values: [3, null],
    })).toEqual({
      field: 'score',
      operator: Operator.Comparison.GreaterThanOrEqual,
      value: 3,
    })
    expect(normalize({
      field: 'score',
      operator: Operator.Comparison.Between,
      values: [null, 6],
    })).toEqual({
      field: 'score',
      operator: Operator.Comparison.LessThanOrEqual,
      value: 6,
    })
    expect(() => normalize({
      field: 'score',
      operator: Operator.Comparison.Between,
      values: [null, null],
    })).toThrow('Between requires at least one non-null bound')
    expect(() => normalize({
      field: 'score',
      operator: Operator.Comparison.Between,
      values: [1],
    })).toThrow('exactly two values')
  })

  test('normalizes Empty for string fields', () => {
    expect(normalize({ field: 'title', operator: Operator.Comparison.Empty })).toEqual({
      filters: [
        { field: 'title', operator: Operator.Comparison.Equal, value: null },
        { field: 'title', operator: Operator.Comparison.Equal, value: '' },
      ],
      operator: Operator.Logical.Or,
    })
    expect(() => normalize({ field: 'score', operator: Operator.Comparison.Empty }))
      .toThrow('Query operator "$empty" is not valid for field "Note.score"')
  })

  test('normalizes Or and unary Not', () => {
    expect(normalize({
      filters: [
        { field: 'score', operator: Operator.Comparison.NotEqual, value: 5 },
        { field: 'title', operator: Operator.Comparison.Empty },
      ],
      operator: Operator.Logical.Or,
    })).toEqual({
      filters: [
        {
          filters: [{ field: 'score', operator: Operator.Comparison.Equal, value: 5 }],
          operator: Operator.Logical.Not,
        },
        {
          filters: [
            { field: 'title', operator: Operator.Comparison.Equal, value: null },
            { field: 'title', operator: Operator.Comparison.Equal, value: '' },
          ],
          operator: Operator.Logical.Or,
        },
      ],
      operator: Operator.Logical.Or,
    })
    expect(normalize({
      filters: [{ field: 'score', operator: Operator.Comparison.Equal, value: 5 }],
      operator: Operator.Logical.Not,
    })).toEqual({
      filters: [{ field: 'score', operator: Operator.Comparison.Equal, value: 5 }],
      operator: Operator.Logical.Not,
    })
    expect(() => normalize({ filters: [], operator: Operator.Logical.Not }))
      .toThrow('requires exactly one filter')
    expect(() => normalize({
      filters: [{ score: 1 }, { score: 2 }],
      operator: Operator.Logical.Not,
    })).toThrow('requires exactly one filter')
  })

  test('rejects unknown fields and operators', () => {
    expect(() => normalize({ missing: 1 })).toThrow('Unknown field "Note.missing"')
    expect(() => normalize({ field: 'score', operator: '$xor', value: 1 }))
      .toThrow('Query operator "$xor" is not supported')
  })

  test('rejects malformed explicit nodes', () => {
    expect(() => normalize({ field: 'score', operator: Operator.Comparison.Equal }))
      .toThrow('requires exactly operator, field, value')
    expect(() => normalize({ extra: true, field: 'score', operator: Operator.Comparison.Equal, value: 1 }))
      .toThrow('requires exactly operator, field, value')
    expect(() => normalize({ filters: [], operator: Operator.Logical.And }))
      .toThrow('requires a non-empty filters array')
    expect(() => normalize({ filters: [], operator: Operator.Logical.Or }))
      .toThrow('requires a non-empty filters array')
    expect(() => normalize({ filters: [{}], operator: Operator.Logical.And }))
      .toThrow('filters must be non-empty objects')
    expect(() => normalize({
      field: 'title',
      operator: Operator.Comparison.Empty,
      value: 'ignored',
    })).toThrow('requires exactly operator, field')
  })
})
