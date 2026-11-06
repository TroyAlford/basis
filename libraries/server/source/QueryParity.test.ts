import { describe, expect, test } from 'bun:test'
import { compileEntityQuery } from './Database'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'
import { Predicate } from './Predicate'
import { QueryNormalizer } from './QueryNormalizer'
import { QueryParser } from './QueryParser'

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'title', type: 'String' },
        { field: 'score', type: 'Number' },
        { field: 'parent', target: 'Note', type: 'Entity' },
        { field: 'tags', items: { type: 'String' }, type: 'Array' },
        { field: 'scores', items: { type: 'Number' }, type: 'Array' },
        { field: 'payload', type: 'JSON' },
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
        { field: 'age', type: 'Number' },
        { field: 'owner', inverse: 'pets', target: 'User', type: 'Entity' },
      ],
      name: 'Pet',
    },
  ],
}))

const note = definitions.entity('Note')
if (!note) throw new Error('missing Note entity')
const identity = '00000000-0000-4000-8000-000000000001'
const eightParents = Array.from({ length: 8 }, () => 'parent').join('.')
const nineParents = Array.from({ length: 9 }, () => 'parent').join('.')
const excessive = Array.from({ length: 129 }, (_, index) => `tag-${index}`)

/**
 * Compile one source comparison for parity.
 * @param entity - Entity being queried.
 * @param where - Source filter.
 * @param extra - Additional query options.
 * @returns The compiled query.
 */
function source(entity: string, where: string, extra: Record<string, unknown> = {}) {
  return compileEntityQuery(definitions, entity, {
    fields: ['id'],
    ...extra,
    where,
  })
}

/**
 * Compile one structured comparison for parity.
 * @param entity - Entity being queried.
 * @param where - Structured filter.
 * @param extra - Additional query options.
 * @returns The compiled query.
 */
function structured(entity: string, where: Readonly<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return compileEntityQuery(definitions, entity, {
    fields: ['id'],
    ...extra,
    where,
  })
}

describe('Query parity gate', () => {
  test('normalizes scalar source and structured forms to the same canonical filter', () => {
    expect(QueryNormalizer.normalize(note, "title = 'Ada'")).toEqual(
      Predicate.normalize(note, {
        field: 'title',
        operator: Operator.Comparison.Equal,
        value: 'Ada',
      }),
    )
    expect(QueryNormalizer.normalize(note, 'score >= 5')).toEqual(
      Predicate.normalize(note, {
        field: 'score',
        operator: Operator.Comparison.GreaterThanOrEqual,
        value: 5,
      }),
    )
  })

  test('preserves source diagnostics with exact offsets', () => {
    const result = QueryParser.parse("title = 'unterminated")
    expect(result.expression).toBeNull()
    expect(result.diagnostics).toEqual([
      { end: 21, message: 'Unterminated string literal', start: 8 },
    ])
  })

  test('preserves order, pagination, and binding parity', () => {
    const sourceQuery = source('Note', "title $contains 'a' $or score >= 5", {
      limit: 2,
      offset: 1,
      orderBy: [
        { direction: 'desc', field: 'title' },
        { direction: 'asc', field: 'score' },
      ],
    })
    const structuredQuery = structured('Note', {
      filters: [
        { field: 'title', operator: Operator.Comparison.Contains, value: 'a' },
        { field: 'score', operator: Operator.Comparison.GreaterThanOrEqual, value: 5 },
      ],
      operator: Operator.Logical.Or,
    }, {
      limit: 2,
      offset: 1,
      orderBy: [
        { direction: 'desc', field: 'title' },
        { direction: 'asc', field: 'score' },
      ],
    })
    expect(sourceQuery).toEqual(structuredQuery)
    expect(sourceQuery.values.at(-2)).toBe(2)
    expect(sourceQuery.values.at(-1)).toBe(1)
  })

  test('rejects equivalent invalid inputs through both input forms', () => {
    const invalid = [
      {
        entity: 'Note',
        message: 'Unknown field',
        source: "missing = 'x'",
        structured: { missing: 'x' },
      },
      {
        entity: 'Note',
        message: 'not a valid number value',
        source: "scores $contains ['x']",
        structured: { field: 'scores', operator: Operator.Comparison.Contains, value: ['x'] },
      },
      {
        entity: 'Note',
        message: 'Unknown scoped member field',
        source: 'scores $contains (@.bad > 1)',
        structured: {
          field: 'scores',
          filters: [{ field: '@.bad', operator: Operator.Comparison.GreaterThan, value: 1 }],
          operator: Operator.Comparison.Contains,
        },
      },
      {
        entity: 'User',
        message: 'Unknown field',
        source: 'pets $contains (@.missing > 1)',
        structured: {
          field: 'pets',
          filters: [{ field: 'missing', operator: Operator.Comparison.GreaterThan, value: 1 }],
          operator: Operator.Comparison.Contains,
        },
      },
      {
        entity: 'Note',
        message: 'maximum depth',
        source: `${nineParents}.title = 'x'`,
        structured: { [`${nineParents}.title`]: 'x' },
      },
      {
        entity: 'Note',
        message: 'maximum of 128 elements',
        source: `tags $contains [${excessive.map(value => `'${value}'`).join(', ')}]`,
        structured: {
          field: 'tags',
          operator: Operator.Comparison.Contains,
          value: excessive,
        },
      },
      {
        entity: 'Note',
        message: 'cannot be represented exactly',
        source: 'payload $contains {amount: 1.0000000000000001}',
        structured: null,
      },
    ] as const
    for (const queryCase of invalid) {
      expect(() => source(queryCase.entity, queryCase.source)).toThrow(queryCase.message)
      if (queryCase.structured) {
        expect(() => structured(queryCase.entity, queryCase.structured)).toThrow(queryCase.message)
      }
    }
  })

  test('enforces the same accepted eight-hop boundary in both forms', () => {
    expect(() => source('Note', `${eightParents}.title = 'x'`)).not.toThrow()
    expect(() => structured('Note', { [`${eightParents}.title`]: 'x' })).not.toThrow()
  })

  test('matches source and structured SQL for arrays, JSON, and scoped members', () => {
    const cases = [
      {
        entity: 'Note',
        source: "tags $contains 'urgent'",
        structured: { field: 'tags', operator: Operator.Comparison.Contains, value: 'urgent' },
      },
      {
        entity: 'Note',
        source: 'scores $all (@ > 0)',
        structured: {
          field: 'scores',
          filters: [{ field: '@', operator: Operator.Comparison.GreaterThan, value: 0 }],
          operator: Operator.Collection.All,
        },
      },
      {
        entity: 'Note',
        source: 'payload $contains {meta: {active: true}}',
        structured: {
          field: 'payload',
          operator: Operator.Comparison.Contains,
          value: { meta: { active: true } },
        },
      },
      {
        entity: 'Note',
        source: 'scores.$count >= 2',
        structured: { field: 'scores.$count', operator: Operator.Comparison.GreaterThanOrEqual, value: 2 },
      },
      {
        entity: 'User',
        source: 'pets.$count = 0',
        structured: { field: 'pets.$count', operator: Operator.Comparison.Equal, value: 0 },
      },
      {
        entity: 'User',
        source: 'pets $contains (@.age > 10)',
        structured: {
          field: 'pets',
          filters: [{ field: 'age', operator: Operator.Comparison.GreaterThan, value: 10 }],
          operator: Operator.Comparison.Contains,
        },
      },
      {
        entity: 'Pet',
        source: `owner = '${identity}'`,
        structured: { field: 'owner', operator: Operator.Comparison.Equal, value: identity },
      },
    ]
    for (const queryCase of cases) {
      expect(source(queryCase.entity, queryCase.source)).toEqual(
        structured(queryCase.entity, queryCase.structured),
      )
    }
  })

  test('supports count paths in predicates, projections, and ordering', () => {
    expect(source('Note', 'scores.$count >= 2')).toEqual(
      structured('Note', {
        field: 'scores.$count',
        operator: Operator.Comparison.GreaterThanOrEqual,
        value: 2,
      }),
    )
    expect(source('User', 'pets.$count > 0')).toMatchObject({
      sql: expect.stringContaining('EXISTS (SELECT 1 FROM "Pet"'),
    })
    expect(source('User', 'pets.$count = 0')).toMatchObject({
      sql: expect.stringContaining('NOT EXISTS (SELECT 1 FROM "Pet"'),
    })
    expect(source('Note', 'scores.$count = 0').sql).toContain('COALESCE(cardinality')
    expect(source('Note', 'scores.$count = 0', { fields: ['id', 'scores.$count'] }).sql)
      .toContain('AS "scores.$count"')
    expect(source('User', 'pets.$count >= 1', { orderBy: 'pets.$count' }).sql)
      .toContain('ORDER BY COALESCE(')
    expect(() => source('Note', 'title.$count > 0')).toThrow('requires a collection or native array field')
    expect(() => source('Pet', 'owner.$count > 0')).toThrow('requires a collection or native array field')
    expect(() => source('Note', 'tags.$count.foo > 0')).toThrow('traverses non-reference field')
  })

  test('rejects collection member lists without requirements in both forms', () => {
    expect(() => source('User', 'pets $contains []')).toThrow('at least one requirement')
    expect(() => structured('User', {
      field: 'pets',
      filters: [],
      operator: Operator.Comparison.Contains,
    })).toThrow('non-empty filters')
  })
})
