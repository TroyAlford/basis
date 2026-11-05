import { describe, expect, test } from 'bun:test'
import { compileEntityQuery } from './Database'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'
import type { Filter } from './Predicate'
import { Predicate } from './Predicate'
import { QueryNormalizer } from './QueryNormalizer'
import { SQL } from './SQL'

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'active', type: 'Boolean' },
        { field: 'createdAt', type: 'Timestamp' },
        { field: 'dueOn', type: 'Date' },
        { field: 'id', format: 'UUID' },
        { field: 'score', type: 'Number' },
        { field: 'title', type: 'String' },
      ],
      name: 'Note',
    },
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
        { field: 'payload', type: 'JSON' },
        { field: 'tags', items: { type: 'String' }, type: 'Array' },
      ],
      name: 'Pet',
    },
  ],
}))

const note = definitions.entity('Note')
if (!note) throw new Error('missing Note entity')
const pet = definitions.entity('Pet')
if (!pet) throw new Error('missing Pet entity')

/** One implemented structured/string parity case. */
interface ParityCase {
  /** Source predicate input. */
  readonly source: string,
  /** Structured predicate input. */
  readonly structured: Filter | Readonly<Record<string, unknown>>,
}

const parityCases: readonly ParityCase[] = [
  {
    source: "title = 'Hello'",
    structured: { field: 'title', operator: Operator.Comparison.Equal, value: 'Hello' },
  },
  {
    source: "title != 'Hello'",
    structured: { field: 'title', operator: Operator.Comparison.NotEqual, value: 'Hello' },
  },
  {
    source: "title <> 'Hello'",
    structured: { field: 'title', operator: Operator.Comparison.NotEqual, value: 'Hello' },
  },
  {
    source: 'score < 10',
    structured: { field: 'score', operator: Operator.Comparison.LessThan, value: 10 },
  },
  {
    source: 'score <= 10',
    structured: { field: 'score', operator: Operator.Comparison.LessThanOrEqual, value: 10 },
  },
  {
    source: 'score > 5',
    structured: { field: 'score', operator: Operator.Comparison.GreaterThan, value: 5 },
  },
  {
    source: 'score >= 5',
    structured: { field: 'score', operator: Operator.Comparison.GreaterThanOrEqual, value: 5 },
  },
  {
    source: 'score $between [5, 10]',
    structured: { field: 'score', operator: Operator.Comparison.Between, values: [5, 10] },
  },
  {
    source: 'score $between [null, 10]',
    structured: { field: 'score', operator: Operator.Comparison.Between, values: [null, 10] },
  },
  {
    source: "title $contains 'Ada'",
    structured: { field: 'title', operator: Operator.Comparison.Contains, value: 'Ada' },
  },
  {
    source: 'title $empty',
    structured: { field: 'title', operator: Operator.Comparison.Empty },
  },
  {
    source: 'score = null',
    structured: { field: 'score', operator: Operator.Comparison.Equal, value: null },
  },
  {
    source: 'score != null',
    structured: { field: 'score', operator: Operator.Comparison.NotEqual, value: null },
  },
  {
    source: 'active = true',
    structured: { field: 'active', operator: Operator.Comparison.Equal, value: true },
  },
  {
    source: "dueOn >= '2026-01-01'",
    structured: { field: 'dueOn', operator: Operator.Comparison.GreaterThanOrEqual, value: '2026-01-01' },
  },
  {
    source: "createdAt < '2026-01-01T00:00:00.000Z'",
    structured: {
      field: 'createdAt',
      operator: Operator.Comparison.LessThan,
      value: '2026-01-01T00:00:00.000Z',
    },
  },
  {
    source: "id = '00000000-0000-4000-8000-000000000001'",
    structured: {
      field: 'id',
      operator: Operator.Comparison.Equal,
      value: '00000000-0000-4000-8000-000000000001',
    },
  },
  {
    source: "score >= 5 $and score < 10 $and title != 'Draft'",
    structured: {
      filters: [
        { field: 'score', operator: Operator.Comparison.GreaterThanOrEqual, value: 5 },
        { field: 'score', operator: Operator.Comparison.LessThan, value: 10 },
        { field: 'title', operator: Operator.Comparison.NotEqual, value: 'Draft' },
      ],
      operator: Operator.Logical.And,
    },
  },
  {
    source: "title = 'Hello' $or title = 'World'",
    structured: {
      filters: [
        { field: 'title', operator: Operator.Comparison.Equal, value: 'Hello' },
        { field: 'title', operator: Operator.Comparison.Equal, value: 'World' },
      ],
      operator: Operator.Logical.Or,
    },
  },
  {
    source: "!(title = 'Draft')",
    structured: {
      filters: [{ field: 'title', operator: Operator.Comparison.Equal, value: 'Draft' }],
      operator: Operator.Logical.Not,
    },
  },
]

describe('Query contract', () => {
  test('normalizes every implemented structured/string case to the same filter and SQL', () => {
    for (const queryCase of parityCases) {
      const structured = Predicate.normalize(note, queryCase.structured)
      const normalized = QueryNormalizer.normalize(note, queryCase.source)
      expect(normalized).toEqual(structured)
      expect(SQL.where(definitions, 'Note', normalized ?? undefined))
        .toEqual(SQL.where(definitions, 'Note', structured ?? undefined))
    }
  })

  test('keeps shorthand and explicit equality equivalent', () => {
    expect(Predicate.normalize(note, { title: 'Hello' })).toEqual(
      Predicate.normalize(note, {
        field: 'title',
        operator: Operator.Comparison.Equal,
        value: 'Hello',
      }),
    )
    expect(QueryNormalizer.normalize(note, "title = 'Hello'")).toEqual(
      Predicate.normalize(note, { title: 'Hello' }),
    )
  })

  test('keeps empty input as no predicate', () => {
    expect(Predicate.normalize(note, {})).toBeNull()
    expect(QueryNormalizer.normalize(note, '   ')).toBeNull()
  })

  test('rejects deferred reference, collection, Array, JSON and sort forms explicitly', () => {
    const deferred = [
      {
        entity: 'Pet',
        source: "owner.name = 'Ada'",
        structured: { field: 'owner.name', operator: Operator.Comparison.Equal, value: 'Ada' },
      },
      {
        entity: 'Pet',
        source: "tags $contains 'urgent'",
        structured: { field: 'tags', operator: Operator.Comparison.Contains, value: 'urgent' },
      },
      {
        entity: 'Pet',
        source: "tags $overlaps ['urgent', 'important']",
        structured: { field: 'tags', operator: '$overlaps', value: ['urgent', 'important'] },
      },
      {
        entity: 'Pet',
        source: 'payload $contains {kind: "note"}',
        structured: { field: 'payload', operator: Operator.Comparison.Contains, value: { kind: 'note' } },
      },
      {
        entity: 'User',
        source: "pets $any (name = 'Ada')",
        structured: {
          field: 'pets',
          filters: [{ field: 'name', operator: Operator.Comparison.Equal, value: 'Ada' }],
          operator: '$any',
        },
      },
    ]
    for (const queryCase of deferred) {
      const entity = definitions.entity(queryCase.entity)
      if (!entity) throw new Error(`missing ${queryCase.entity} entity`)
      expect(() => Predicate.normalize(entity, queryCase.structured)).toThrow()
      expect(() => QueryNormalizer.normalize(entity, queryCase.source)).toThrow()
    }

    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      orderBy: 'owner.name',
    })).toThrow()
    expect(() => compileEntityQuery(definitions, 'User', {
      fields: ['id'],
      orderBy: 'pets',
    })).toThrow()
  })

  test('rejects malformed or incompatible scalar operators before execution', () => {
    expect(() => Predicate.normalize(note, {
      field: 'title',
      operator: Operator.Comparison.Between,
      values: [1],
    })).toThrow()
    expect(() => SQL.where(definitions, 'Note', {
      field: 'active',
      operator: Operator.Comparison.GreaterThan,
      value: true,
    })).toThrow()
    expect(() => Predicate.normalize(note, {
      field: 'title',
      operator: Operator.Comparison.Empty,
      value: 'unexpected',
    })).toThrow()
    expect(() => QueryNormalizer.normalize(note, 'score $between [1]')).toThrow()
    expect(() => QueryNormalizer.normalize(note, "title = 'unterminated")).toThrow()
  })

  test('preserves the source diagnostic offset for malformed string input', () => {
    expect(() => QueryNormalizer.normalize(note, "title = 'unterminated")).toThrow('at 8')
  })
})
