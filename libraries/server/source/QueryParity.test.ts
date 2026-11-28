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
        { field: 'favoriteIds', items: { format: 'UUID', type: 'ID' }, type: 'Array' },
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

const eligibilityEntities = [
  {
    fields: [
      { field: 'id', format: 'UUID' },
      { field: 'label', type: 'String' },
    ],
    name: 'A',
  },
  {
    extends: 'A',
    fields: [
      { field: 'foo', nullable: true, type: 'Number' },
      { field: 'scores', items: { type: 'Number' }, type: 'Array' },
      { cardinality: 'Many', field: 'items', inverse: 'ownerB', target: 'Item', type: 'Inverse' },
    ],
    name: 'B',
  },
  {
    extends: 'A',
    fields: [
      { field: 'foo', nullable: true, type: 'Number' },
      { cardinality: 'Many', field: 'items', inverse: 'ownerC', target: 'Item', type: 'Inverse' },
    ],
    name: 'C',
  },
  { extends: 'A', fields: [], name: 'D' },
  {
    fields: [
      { field: 'id', format: 'UUID' },
      { field: 'title', type: 'String' },
      { field: 'ownerB', inverse: 'items', target: 'B', type: 'Entity' },
      { field: 'ownerC', inverse: 'items', target: 'C', type: 'Entity' },
    ],
    name: 'Item',
  },
]
const eligibilityDefinitions = EntityDefinitions.load(JSON.stringify({ entities: eligibilityEntities }))
const eligibilityDefinitionsReversed = EntityDefinitions.load(JSON.stringify({
  entities: [
    eligibilityEntities[0],
    eligibilityEntities[2],
    eligibilityEntities[1],
    ...eligibilityEntities.slice(3),
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

  test('matches source and structured scalar $in predicates', () => {
    const sourceQuery = source('Note', "title $in ['A', 'B']")
    const structuredQuery = structured('Note', {
      field: 'title',
      operator: Operator.Comparison.In,
      value: ['A', 'B'],
    })
    expect(sourceQuery).toEqual(structuredQuery)
    expect(sourceQuery.sql).toContain('"title" IN ($1, $2)')
    expect(sourceQuery.values.slice(0, 2)).toEqual(['A', 'B'])
    expect(sourceQuery.values).not.toContain('C')
    expect(QueryNormalizer.normalize(note, "title $in ['A', 'B']")).toEqual(
      Predicate.normalize(note, {
        field: 'title',
        operator: Operator.Comparison.In,
        value: ['A', 'B'],
      }),
    )
    expect(source('Note', 'score $in [10, 20, 30]')).toEqual(
      structured('Note', {
        field: 'score',
        operator: Operator.Comparison.In,
        value: [10, 20, 30],
      }),
    )
  })

  test('lowers field-backed $in membership into native-array containment', () => {
    expect(QueryNormalizer.normalize(note, 'id $in favoriteIds')).toEqual(
      Predicate.normalize(note, {
        field: 'favoriteIds',
        operator: Operator.Comparison.Contains,
        value: { $field: 'id' },
      }),
    )
    expect(QueryNormalizer.normalize(note, '$me $in favoriteIds')).toEqual(
      Predicate.normalize(note, {
        field: 'favoriteIds',
        operator: Operator.Comparison.Contains,
        value: '$me',
      }),
    )
    expect(QueryNormalizer.normalize(note, '$me $in favoriteIds')).toEqual({
      field: 'favoriteIds',
      operator: Operator.Comparison.Contains,
      value: ['$me'],
    })
    expect(QueryNormalizer.normalize(note, 'title $in tags')).toEqual(
      Predicate.normalize(note, {
        field: 'tags',
        operator: Operator.Comparison.Contains,
        value: { $field: 'title' },
      }),
    )
    expect(QueryNormalizer.normalize(note, 'tags $contains title')).toEqual(
      QueryNormalizer.normalize(note, 'title $in tags'),
    )
    expect(QueryNormalizer.normalize(note, 'favoriteIds $contains id')).toEqual(
      QueryNormalizer.normalize(note, 'id $in favoriteIds'),
    )
    expect(QueryNormalizer.normalize(note, 'favoriteIds $contains $me')).toEqual(
      QueryNormalizer.normalize(note, '$me $in favoriteIds'),
    )
    expect(source('Note', 'id $in favoriteIds')).toEqual(structured('Note', {
      field: 'id',
      operator: Operator.Comparison.In,
      value: { $field: 'favoriteIds' },
    }))
    expect(source('Note', '$me $in favoriteIds')).toEqual(structured('Note', {
      field: '$me',
      operator: Operator.Comparison.In,
      value: { $field: 'favoriteIds' },
    }))
    expect(source('Note', 'title $in tags')).toEqual(structured('Note', {
      field: 'title',
      operator: Operator.Comparison.In,
      value: { $field: 'tags' },
    }))
    expect(source('Note', 'tags $contains title')).toEqual(source('Note', 'title $in tags'))
  })

  test('rejects incompatible or non-array field-backed membership', () => {
    const invalid = [
      {
        message: 'not comparable with native array',
        source: 'id $in tags',
        structured: { field: 'id', operator: Operator.Comparison.In, value: { $field: 'tags' } },
      },
      {
        message: 'not comparable with native array',
        source: 'title $in favoriteIds',
        structured: {
          field: 'title',
          operator: Operator.Comparison.In,
          value: { $field: 'favoriteIds' },
        },
      },
      {
        message: 'not a native array',
        source: 'id $in title',
        structured: { field: 'id', operator: Operator.Comparison.In, value: { $field: 'title' } },
      },
      {
        message: 'not a native array',
        source: 'id $in missing',
        structured: { field: 'id', operator: Operator.Comparison.In, value: { $field: 'missing' } },
      },
      {
        message: 'must compare actor presence with null',
        source: `$me $in ['${identity}']`,
        structured: {
          field: '$me',
          operator: Operator.Comparison.In,
          value: [identity],
        },
      },
    ] as const
    for (const queryCase of invalid) {
      expect(() => source('Note', queryCase.source)).toThrow(queryCase.message)
      expect(() => structured('Note', queryCase.structured)).toThrow(queryCase.message)
    }
  })

  test('rejects the actor sentinel outside native-array containment', () => {
    const invalid = [
      {
        source: "favoriteIds == ['$me']",
        structured: { field: 'favoriteIds', operator: Operator.Comparison.Equal, value: ['$me'] },
      },
      {
        source: "favoriteIds $overlaps ['$me']",
        structured: {
          field: 'favoriteIds',
          operator: Operator.Comparison.Overlaps,
          value: ['$me'],
        },
      },
      {
        source: "favoriteIds $sequenceEqual ['$me']",
        structured: {
          field: 'favoriteIds',
          operator: Operator.Comparison.SequenceEqual,
          value: ['$me'],
        },
      },
    ] as const
    for (const queryCase of invalid) {
      expect(() => source('Note', queryCase.source)).toThrow('native-array containment')
      expect(() => structured('Note', queryCase.structured)).toThrow('native-array containment')
    }
  })

  test('rejects malformed scalar $in predicates in both forms', () => {
    const invalid = [
      {
        message: 'non-empty',
        source: 'title $in []',
        structured: { field: 'title', operator: Operator.Comparison.In, value: [] },
      },
      {
        message: 'cannot contain null',
        source: 'title $in [null]',
        structured: { field: 'title', operator: Operator.Comparison.In, value: [null] },
      },
      {
        message: 'scalar',
        source: "title $in [['A']]",
        structured: { field: 'title', operator: Operator.Comparison.In, value: [['A']] },
      },
      {
        message: 'not a valid string value',
        source: "title $in ['A', 7]",
        structured: { field: 'title', operator: Operator.Comparison.In, value: ['A', 7] },
      },
      {
        message: 'not valid for field',
        source: "tags $in ['a']",
        structured: { field: 'tags', operator: Operator.Comparison.In, value: ['a'] },
      },
      {
        message: 'not valid for field',
        source: "payload $in ['a']",
        structured: { field: 'payload', operator: Operator.Comparison.In, value: ['a'] },
      },
      {
        message: 'must compare actor presence with null',
        source: `$me $in ['${identity}']`,
        structured: {
          field: '$me',
          operator: Operator.Comparison.In,
          value: [identity],
        },
      },
      {
        message: 'maximum of 128 elements',
        source: `title $in [${excessive.map(value => `'${value}'`).join(', ')}]`,
        structured: {
          field: 'title',
          operator: Operator.Comparison.In,
          value: excessive,
        },
      },
    ] as const
    for (const queryCase of invalid) {
      expect(() => source('Note', queryCase.source)).toThrow(queryCase.message)
      expect(() => structured('Note', queryCase.structured)).toThrow(queryCase.message)
    }
    expect(() => source('User', 'id $in pets')).toThrow('not a native array')
    expect(() => structured('User', {
      field: 'id',
      operator: Operator.Comparison.In,
      value: { $field: 'pets' },
    })).toThrow('not a native array')
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
        source: 'scores.$total >= 2',
        structured: { field: 'scores.$total', operator: Operator.Comparison.GreaterThanOrEqual, value: 2 },
      },
      {
        entity: 'User',
        source: 'pets.$total = 0',
        structured: { field: 'pets.$total', operator: Operator.Comparison.Equal, value: 0 },
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
    expect(source('Note', 'scores.$total >= 2')).toEqual(
      structured('Note', {
        field: 'scores.$total',
        operator: Operator.Comparison.GreaterThanOrEqual,
        value: 2,
      }),
    )
    expect(source('User', 'pets.$total > 0')).toMatchObject({
      sql: expect.stringContaining('EXISTS (SELECT 1 FROM ('),
    })
    expect(source('User', 'pets.$total = 0')).toMatchObject({
      sql: expect.stringContaining('NOT EXISTS (SELECT 1 FROM ('),
    })
    expect(source('Note', 'scores.$total = 0').sql).toContain('COALESCE(cardinality')
    expect(source('Note', 'scores.$total = 0', { fields: ['id', 'scores.$total'] }).sql)
      .toContain('AS "scores.$total"')
    expect(source('User', 'pets.$total >= 1', { orderBy: 'pets.$total' }).sql)
      .toContain('ORDER BY (SELECT count')
    expect(() => source('Note', 'title.$total > 0')).toThrow('requires a collection or native array field')
    expect(() => source('Pet', 'owner.$total > 0')).toThrow('requires a collection or native array field')
    expect(() => source('Note', 'tags.$total.foo > 0')).toThrow('traverses non-reference field')
  })

  test('supports filtered matched counts in predicates', () => {
    const normalize = (query: ReturnType<typeof source>) => ({
      sql: query.sql.replace(/\bcm\d+\b/gu, 'cm'),
      values: query.values,
    })
    const sourceQuery = source('User', 'pets[age > 1].$matched >= 2')
    const structuredQuery = structured('User', {
      field: 'pets[age > 1].$matched',
      operator: Operator.Comparison.GreaterThanOrEqual,
      value: 2,
    })
    expect(normalize(sourceQuery)).toEqual(normalize(structuredQuery))
    expect(sourceQuery.sql).toContain('count(*)::int')
    expect(sourceQuery.values).toEqual([1, 2, 25, 0])
    expect(normalize(source('User', 'pets[age > 1].$total >= 2'))).toEqual(
      normalize(structured('User', {
        field: 'pets[age > 1].$total',
        operator: Operator.Comparison.GreaterThanOrEqual,
        value: 2,
      })),
    )
    expect(normalize(source('User', 'pets.$matched >= 2')).sql)
      .toBe(normalize(source('User', 'pets.$total >= 2')).sql)
    expect(source('User', 'pets[owner.id = $me].$matched >= 2').sql).toContain('actor.id')
    expect(source('User', "pets[owner.name = 'Ada'].$matched >= 2").sql).toContain('owner')
    expect(() => source('Note', 'title.$matched > 0'))
      .toThrow('requires a collection or native array field')
    expect(() => structured('User', {
      field: 'pets{$limit:2}.$matched',
      operator: Operator.Comparison.GreaterThan,
      value: 0,
    })).toThrow('does not accept limit, offset, or orderBy directives')
    expect(() => source('User', 'pets{$limit:2}.$matched > 0'))
      .toThrow('does not accept limit, offset, or orderBy directives')
    expect(() => source('User', 'pets{$offset:1}.$total > 0'))
      .toThrow('does not accept limit, offset, or orderBy directives')
  })

  test('rejects collection member lists without requirements in both forms', () => {
    expect(() => source('User', 'pets $contains []')).toThrow('at least one requirement')
    expect(() => structured('User', {
      field: 'pets',
      filters: [],
      operator: Operator.Comparison.Contains,
    })).toThrow('non-empty filters')
  })

  test('compiles descendant eligibility guards for ordinary predicates', () => {
    const compile = (
      where: string,
      model = eligibilityDefinitions,
    ) => compileEntityQuery(model, 'A', { fields: ['id'], limit: null, where })

    const equality = compile('foo = 7')
    expect(equality.values).toEqual(['B', 'C', 7])
    expect(equality.sql).toContain('"entity" IN ($1, $2)')
    expect(compile('foo = null').values).toEqual(['B', 'C'])
    expect(compile('NOT(foo = 7)').values).toEqual(['B', 'C', 7])
    expect(compile("foo = 7 OR label = 'd'").values).toEqual(['B', 'C', 7, 'd'])
    expect(() => compile('missing = 1')).toThrow('Unknown field')

    const contains = compile("items $contains (title = 'match')")
    expect(contains.values).toEqual(['B', 'C', 'match', 'match'])
    expect(contains.sql).toContain('"ownerB.id"')
    expect(contains.sql).toContain('"ownerC.id"')
    expect(compile('items.$total = 0').values).toEqual(['B', 'C'])
    expect(compile("items[title = 'match'].$matched >= 1").values)
      .toEqual(['B', 'C', 'match', 'match', 1])

    const scores = compile('scores.$total = 0')
    expect(scores.values).toEqual(['B'])
    expect(scores.sql).toContain('cardinality')
    expect(compile('NOT(scores.$total > 0)').values).toEqual(['B'])
    expect(compile('scores.$total = 0')).toEqual(compileEntityQuery(
      eligibilityDefinitions,
      'A',
      {
        fields: ['id'],
        limit: null,
        where: { field: 'scores.$total', operator: Operator.Comparison.Equal, value: 0 },
      },
    ))

    const reversed = compile('foo = 7', eligibilityDefinitionsReversed)
    expect([...reversed.values.slice(0, 2)].sort()).toEqual(['B', 'C'])
    expect(reversed.sql).toContain('"entity" IN')
  })
})
