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
      extends: 'User',
      fields: [
        { field: 'manager', target: 'User', type: 'Entity' },
        { field: 'permissions', type: 'String' },
      ],
      name: 'SystemUser',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'age', type: 'Number' },
        { field: 'favorite', target: 'User', type: 'Entity' },
        { field: 'labels', items: { type: 'String' }, type: 'Array' },
        { field: 'owner', inverse: 'pets', target: 'User', type: 'Entity' },
        { field: 'payload', type: 'JSON' },
        { field: 'scores', items: { type: 'Number' }, type: 'Array' },
        { field: 'tags', items: { type: 'String' }, type: 'Array' },
        { field: 'vaccinated', type: 'Boolean' },
      ],
      name: 'Pet',
    },
  ],
}))

const note = definitions.entity('Note')
if (!note) throw new Error('missing Note entity')
const pet = definitions.entity('Pet')
if (!pet) throw new Error('missing Pet entity')

const relationshipDefinitions = EntityDefinitions.load(JSON.stringify({
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
      ],
      name: 'User',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'title', type: 'String' },
        { field: 'owner', inverse: 'pets', target: 'User', type: 'Entity' },
        { field: 'tags', items: { type: 'String' }, type: 'Array' },
      ],
      name: 'Pet',
    },
    { fields: [], name: 'Campaign' },
  ],
  relationships: [{
    between: [
      { field: 'user', inverse: 'campaigns', target: 'User' },
      { field: 'campaign', inverse: 'members', target: 'Campaign' },
    ],
    fields: [
      { field: 'role', type: 'String' },
      { field: 'tags', items: { type: 'String' }, type: 'Array' },
    ],
    name: 'Membership',
  }],
}))

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

  test('supports model-validated singular reference paths and descendant predicates', () => {
    const structured = compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { 'owner.name': 'Ada' },
    })
    const source = compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: "owner.name = 'Ada'",
    })
    expect(source).toEqual(structured)
    expect(structured.sql).toContain('JOIN "User"')
    expect(structured.sql).toContain('WHERE')

    expect(compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { 'owner.permissions': 'admin' },
    })).toEqual(compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: "owner.permissions = 'admin'",
    }))

    expect(compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { 'owner.manager.name': 'Manager' },
    })).toEqual(compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: "owner.manager.name = 'Manager'",
    }))

    expect(compileEntityQuery(definitions, 'User', {
      fields: ['id'],
      where: { permissions: 'admin' },
    })).toEqual(compileEntityQuery(definitions, 'User', {
      fields: ['id'],
      where: "permissions = 'admin'",
    }))

    const identity = '00000000-0000-4000-8000-000000000001'
    expect(compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { owner: identity },
    })).toEqual(compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: `owner = '${identity}'`,
    }))
    expect(compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { owner: null },
    })).toEqual(compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: 'owner = null',
    }))

    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { field: 'owner', operator: '$gt', value: identity },
    })).toThrow('reference identity')
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { field: 'owner', operator: Operator.Comparison.Contains, value: 'Ada' },
    })).toThrow('reference identity')
  })

  test('keys terminal reference identities independently', () => {
    const identity = '00000000-0000-4000-8000-000000000001'
    const second = '00000000-0000-4000-8000-000000000002'
    const two = compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: {
        filters: [
          { field: 'owner', operator: Operator.Comparison.Equal, value: identity },
          { field: 'favorite', operator: Operator.Comparison.Equal, value: second },
        ],
        operator: Operator.Logical.And,
      },
    })
    expect(two.sql.match(/LEFT JOIN "User"/g)).toBeNull()
    expect(two.sql).toContain('"owner.id"')
    expect(two.sql).toContain('"favorite.id"')
    expect(two.values).toEqual([identity, second, 25, 0])

    const nestedDefinitions = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'manager', target: 'Person', type: 'Entity' },
          ],
          name: 'Person',
        },
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'owner', target: 'Person', type: 'Entity' },
          ],
          name: 'Pet',
        },
      ],
    }))
    const nested = compileEntityQuery(nestedDefinitions, 'Pet', {
      fields: ['id'],
      where: { 'owner.manager': identity },
    })
    expect(nested.sql.match(/LEFT JOIN "Person"/g)).toHaveLength(1)
    expect(nested.values).toEqual([identity, 25, 0])
  })

  test('shares filter joins without projecting filter-only identities', () => {
    const filterOnly = compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: {
        filters: [
          { field: 'owner.name', operator: Operator.Comparison.Equal, value: 'Ada' },
          { field: 'owner.permissions', operator: Operator.Comparison.Equal, value: 'admin' },
        ],
        operator: Operator.Logical.And,
      },
    })
    expect(filterOnly.sql).not.toContain('owner__id')
    expect(filterOnly.sql.match(/LEFT JOIN "User"/g)).toHaveLength(1)
    expect(filterOnly.sql.match(/LEFT JOIN "SystemUser"/g)).toHaveLength(1)

    const combined = compileEntityQuery(definitions, 'Pet', {
      fields: ['id', 'owner'],
      where: { 'owner.name': 'Ada' },
    })
    expect(combined.sql.match(/LEFT JOIN "User"/g)).toHaveLength(1)
    expect(combined.sql.match(/LEFT JOIN "Entity"/g)).toHaveLength(1)
    expect(combined.sql).toContain('owner__id')
  })

  test('enforces reference depth and target identity format in filters', () => {
    const treeDefinitions = EntityDefinitions.load(JSON.stringify({
      entities: [{
        fields: [
          { field: 'id', format: 'UUID' },
          { field: 'label', type: 'String' },
          { field: 'parent', target: 'TreeNode', type: 'Entity' },
        ],
        name: 'TreeNode',
      }],
    }))
    const eight = `${Array.from({ length: 8 }, () => 'parent').join('.')}.label`
    const nine = `${Array.from({ length: 9 }, () => 'parent').join('.')}.label`
    expect(() => compileEntityQuery(treeDefinitions, 'TreeNode', {
      fields: ['id'],
      where: `${eight} = 'x'`,
    })).not.toThrow()
    expect(() => compileEntityQuery(treeDefinitions, 'TreeNode', {
      fields: ['id'],
      where: `${nine} = 'x'`,
    })).toThrow('maximum depth')
    expect(() => compileEntityQuery(treeDefinitions, 'TreeNode', {
      fields: ['id'],
      where: { [nine]: 'x' },
    })).toThrow('maximum depth')

    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { owner: '9223372036854775807' },
    })).toThrow('not a valid id value')
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: 'owner = \'9223372036854775807\'',
    })).toThrow('not a valid id value')
  })

  test('compiles native Array and opaque JSON predicates through one path', () => {
    const cases = [
      {
        source: "tags $contains 'urgent'",
        structured: { field: 'tags', operator: Operator.Comparison.Contains, value: 'urgent' },
      },
      {
        source: "tags $contains ['urgent', 'important']",
        structured: {
          field: 'tags',
          operator: Operator.Comparison.Contains,
          value: ['urgent', 'important'],
        },
      },
      {
        source: "tags ~= ['urgent']",
        structured: { field: 'tags', operator: Operator.Comparison.Contains, value: ['urgent'] },
      },
      {
        source: "tags $overlaps ['urgent', 'important']",
        structured: {
          field: 'tags',
          operator: Operator.Comparison.Overlaps,
          value: ['urgent', 'important'],
        },
      },
      {
        source: "tags $overlaps 'urgent'",
        structured: { field: 'tags', operator: Operator.Comparison.Overlaps, value: 'urgent' },
      },
      {
        source: 'tags $empty',
        structured: { field: 'tags', operator: Operator.Comparison.Empty },
      },
      {
        source: 'tags !$empty',
        structured: {
          filters: [{ field: 'tags', operator: Operator.Comparison.Empty }],
          operator: Operator.Logical.Not,
        },
      },
      {
        source: "tags == ['b', 'a']",
        structured: { field: 'tags', operator: Operator.Comparison.Equal, value: ['b', 'a'] },
      },
      {
        source: "tags === ['b', 'a']",
        structured: {
          field: 'tags',
          operator: Operator.Comparison.SequenceEqual,
          value: ['b', 'a'],
        },
      },
      {
        source: 'payload $contains {kind: "note"}',
        structured: {
          field: 'payload',
          operator: Operator.Comparison.Contains,
          value: { kind: 'note' },
        },
      },
      {
        source: 'payload $contains {meta: {active: true}}',
        structured: {
          field: 'payload',
          operator: Operator.Comparison.Contains,
          value: { meta: { active: true } },
        },
      },
      {
        source: "payload $contains ['a', 'b']",
        structured: { field: 'payload', operator: Operator.Comparison.Contains, value: ['a', 'b'] },
      },
      {
        source: 'payload $contains {kind: null}',
        structured: {
          field: 'payload',
          operator: Operator.Comparison.Contains,
          value: { kind: null },
        },
      },
    ]
    for (const queryCase of cases) {
      const fromSource = compileEntityQuery(definitions, 'Pet', {
        fields: ['id'],
        where: queryCase.source,
      })
      const fromStructure = compileEntityQuery(definitions, 'Pet', {
        fields: ['id'],
        where: queryCase.structured,
      })
      expect(fromSource.sql).toBe(fromStructure.sql)
      expect(fromSource.values).toEqual(fromStructure.values)
    }

    const array = compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: "tags $contains ['urgent', 'important']",
    })
    expect(array.sql).toContain('"tags" @> ARRAY[$1::text, $2::text]')
    expect(array.values).toEqual(['urgent', 'important', 25, 0])

    const setEqual = compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: "tags == ['b', 'a']",
    })
    expect(setEqual.sql).toContain('"tags" @>')
    expect(setEqual.sql).toContain('"tags" <@')
    expect(setEqual.sql).not.toContain('unnest')
    expect(setEqual.values).toEqual(['b', 'a', 25, 0])

    const json = compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: 'payload $contains {kind: "note"}',
    })
    expect(json.sql).toContain('"payload" @> $1::text::jsonb')
    expect(json.values).toEqual([JSON.stringify({ kind: 'note' }), 25, 0])

    const ordered = compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: 'payload $contains {kind: "note", meta: {active: true}}',
    })
    const reordered = compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: {
        field: 'payload',
        operator: Operator.Comparison.Contains,
        value: { kind: 'note', meta: { active: true } },
      },
    })
    expect(ordered.sql).toBe(reordered.sql)
    expect(ordered.values).toEqual(reordered.values)

    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: 'tags $contains [null]',
    })).toThrow('cannot contain null')
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: "tags $eq 'urgent'",
    })).toThrow('requires an array operand')
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: "tags === 'urgent'",
    })).toThrow('requires an array operand')
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { field: 'tags', operator: Operator.Comparison.Between, values: ['a', 'z'] },
    })).toThrow('not valid')
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { field: 'payload', operator: Operator.Comparison.Equal, value: {} },
    })).toThrow('not valid for JSON')
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { field: 'payload', operator: Operator.Comparison.Empty },
    })).toThrow('not valid for field')

    const moderate = Array.from({ length: 16 }, (_, index) => `tag-${index}`)
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { field: 'tags', operator: Operator.Comparison.Contains, value: moderate },
    })).not.toThrow()
    const excessive = Array.from({ length: 129 }, (_, index) => `tag-${index}`)
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: { field: 'tags', operator: Operator.Comparison.Contains, value: excessive },
    })).toThrow('maximum of 128 elements')
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: 'payload $contains {account: 9007199254740993}',
    })).toThrow('safe integer range')
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: 'payload $contains {amount: 1.0000000000000001}',
    })).toThrow('cannot be represented exactly')
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: 'payload $contains {amount: 9007199254740991.1}',
    })).toThrow('cannot be represented exactly')
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: 'payload $contains {amount: 1.0}',
    })).not.toThrow()
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: 'payload $contains {amount: 1e2}',
    })).not.toThrow()

    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      orderBy: 'owner.name',
    })).toThrow()
    expect(() => compileEntityQuery(definitions, 'User', {
      fields: ['id'],
      orderBy: 'pets',
    })).toThrow()
  })

  test('compiles explicit scoped member predicates for arrays and collections', () => {
    const cases = [
      {
        entity: 'Pet',
        source: 'scores $contains (@ >= 10)',
        structured: {
          field: 'scores',
          filters: [{ field: '@', operator: Operator.Comparison.GreaterThanOrEqual, value: 10 }],
          operator: Operator.Comparison.Contains,
        },
      },
      {
        entity: 'Pet',
        source: 'scores $all (@ > 0)',
        structured: {
          field: 'scores',
          filters: [{ field: '@', operator: Operator.Comparison.GreaterThan, value: 0 }],
          operator: Operator.Collection.All,
        },
      },
      {
        entity: 'Pet',
        source: 'labels $all (@ != ' + "'deprecated'" + ')',
        structured: {
          field: 'labels',
          filters: [{ field: '@', operator: Operator.Comparison.NotEqual, value: 'deprecated' }],
          operator: Operator.Collection.All,
        },
      },
      {
        entity: 'Pet',
        source: 'scores $contains (@ > 5 $and @ < 20)',
        structured: {
          field: 'scores',
          filters: [{
            filters: [
              { field: '@', operator: Operator.Comparison.GreaterThan, value: 5 },
              { field: '@', operator: Operator.Comparison.LessThan, value: 20 },
            ],
            operator: Operator.Logical.And,
          }],
          operator: Operator.Comparison.Contains,
        },
      },
      {
        entity: 'Pet',
        source: 'scores $contains [(@ = 1), (@ = 2)]',
        structured: {
          field: 'scores',
          filters: [
            { field: '@', operator: Operator.Comparison.Equal, value: 1 },
            { field: '@', operator: Operator.Comparison.Equal, value: 2 },
          ],
          operator: Operator.Comparison.Contains,
        },
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
        entity: 'User',
        source: "pets $contains (@ = '00000000-0000-4000-8000-000000000001')",
        structured: {
          field: 'pets',
          filters: [{
            field: 'id',
            operator: Operator.Comparison.Equal,
            value: '00000000-0000-4000-8000-000000000001',
          }],
          operator: Operator.Comparison.Contains,
        },
      },
      {
        entity: 'User',
        source: 'pets $all (@.vaccinated = true)',
        structured: {
          field: 'pets',
          filters: [{ field: 'vaccinated', operator: Operator.Comparison.Equal, value: true }],
          operator: Operator.Collection.All,
        },
      },
    ]
    for (const queryCase of cases) {
      const source = compileEntityQuery(definitions, queryCase.entity, {
        fields: ['id'],
        where: queryCase.source,
      })
      const structured = compileEntityQuery(definitions, queryCase.entity, {
        fields: ['id'],
        where: queryCase.structured,
      })
      expect(source.sql).toBe(structured.sql)
      expect(source.values).toEqual(structured.values)
    }

    const relative = compileEntityQuery(definitions, 'User', {
      fields: ['id'],
      where: 'pets $contains (age > 10)',
    })
    const scoped = compileEntityQuery(definitions, 'User', {
      fields: ['id'],
      where: 'pets $contains (@.age > 10)',
    })
    expect(scoped.sql).toBe(relative.sql)
    expect(scoped.values).toEqual(relative.values)
    expect(() => compileEntityQuery(definitions, 'Pet', {
      fields: ['id'],
      where: 'scores $contains (@.unknown > 1)',
    })).toThrow('Unknown scoped member field')
    expect(() => compileEntityQuery(definitions, 'User', {
      fields: ['id'],
      where: 'pets $contains (@.unknown > 1)',
    })).toThrow('Unknown field')
  })

  test('compiles collection contains, universal, empty, and bracketed requirements', () => {
    const cases = [
      {
        entity: 'User',
        source: "pets $contains (owner.title = 'Ada')",
        structured: {
          field: 'pets',
          filters: [{ field: 'owner.title', operator: Operator.Comparison.Equal, value: 'Ada' }],
          operator: Operator.Comparison.Contains,
        },
      },
      {
        entity: 'User',
        source: "pets ~= (owner = '00000000-0000-4000-8000-000000000001')",
        structured: {
          field: 'pets',
          filters: [{
            field: 'owner',
            operator: Operator.Comparison.Equal,
            value: '00000000-0000-4000-8000-000000000001',
          }],
          operator: Operator.Comparison.Contains,
        },
      },
      {
        entity: 'User',
        source: "pets !$contains (title = 'Ada')",
        structured: {
          filters: [{
            field: 'pets',
            filters: [{ field: 'title', operator: Operator.Comparison.Equal, value: 'Ada' }],
            operator: Operator.Comparison.Contains,
          }],
          operator: Operator.Logical.Not,
        },
      },
      {
        entity: 'User',
        source: "pets $all (title = 'Ada' $and owner.title = 'Grace')",
        structured: {
          field: 'pets',
          filters: [{
            filters: [
              { field: 'title', operator: Operator.Comparison.Equal, value: 'Ada' },
              { field: 'owner.title', operator: Operator.Comparison.Equal, value: 'Grace' },
            ],
            operator: Operator.Logical.And,
          }],
          operator: Operator.Collection.All,
        },
      },
      {
        entity: 'Campaign',
        source: "members $contains (membership.role = 'GM')",
        structured: {
          field: 'members',
          filters: [{ field: 'membership.role', operator: Operator.Comparison.Equal, value: 'GM' }],
          operator: Operator.Comparison.Contains,
        },
      },
      {
        entity: 'User',
        source: 'pets $empty',
        structured: { field: 'pets', operator: Operator.Comparison.Empty },
      },
      {
        entity: 'User',
        source: 'pets !$empty',
        structured: {
          filters: [{ field: 'pets', operator: Operator.Comparison.Empty }],
          operator: Operator.Logical.Not,
        },
      },
    ]
    for (const queryCase of cases) {
      const fromSource = compileEntityQuery(relationshipDefinitions, queryCase.entity, {
        fields: ['id'],
        where: queryCase.source,
      })
      const fromStructure = compileEntityQuery(relationshipDefinitions, queryCase.entity, {
        fields: ['id'],
        where: queryCase.structured,
      })
      expect(fromSource.sql).toBe(fromStructure.sql)
      expect(fromSource.values).toEqual(fromStructure.values)
    }

    const bracketed = compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: "pets $contains [(title = 'Ada'), (owner.title = 'Grace')]",
    })
    const grouped = compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: "pets $contains (title = 'Ada' $and owner.title = 'Grace')",
    })
    expect(bracketed.sql.match(/EXISTS \(SELECT 1 FROM "Pet"/gu)).toHaveLength(2)
    expect(grouped.sql.match(/EXISTS \(SELECT 1 FROM "Pet"/gu)).toHaveLength(1)
    expect(bracketed.values).toEqual(['Ada', 'Grace', 25, 0])

    const all = compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: "pets $all (title = 'Ada')",
    })
    const counterexample = compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: "pets !$contains ($not (title = 'Ada'))",
    })
    expect(all.sql).toBe(counterexample.sql)
    expect(all.values).toEqual(counterexample.values)

    expect(compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: "pets $contains (owner.title = 'Ada')",
    }).sql).toContain('LEFT JOIN "User"')
    expect(compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id'],
      where: "members $contains (membership.role = 'GM')",
    }).sql).toContain('"cj')
    expect(compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: 'pets $empty',
    }).sql).toContain('NOT EXISTS (SELECT 1 FROM "Pet"')
  })

  test('rejects invalid collection predicates without changing the SQL path', () => {
    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: { field: 'pets', filters: [], operator: Operator.Comparison.Contains },
    })).toThrow('non-empty filters')
    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: "friends $contains (title = 'Ada')",
    })).toThrow('Unknown collection or array navigation')
    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: "pets $contains (tags $contains (title = 'Ada'))",
    })).toThrow('Unknown collection or array navigation')
    expect(() => compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id'],
      where: "members $contains (membership.tags = 'urgent')",
    })).toThrow('not a scalar property')
    expect(() => compileEntityQuery(relationshipDefinitions, 'Campaign', {
      fields: ['id'],
      where: "members $contains (membership.unknown = 'x')",
    })).toThrow('Unknown relationship field')
    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: "pets $contains (tags = 'urgent')",
    })).toThrow('requires an array operand')
    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: "pets $contains (owner.unknown = 'x')",
    })).toThrow('Unknown field')
    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: "pets $contains (owner > '00000000-0000-4000-8000-000000000001')",
    })).toThrow('not valid for reference identity')
    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: { field: 'pets', operator: Operator.Comparison.Equal, value: null },
    })).toThrow('not valid for collection navigation')
    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: {
        field: 'pets',
        filters: [{ field: 'title', operator: Operator.Comparison.Equal, value: 'Ada' }],
        operator: Operator.Collection.All,
      },
    })).not.toThrow()
    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: { field: 'pets', filters: [], operator: Operator.Collection.All },
    })).toThrow('non-empty filters')
    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: 'pets $contains []',
    })).toThrow('at least one requirement')
    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: 'pets $all [(title = \'Ada\')]',
    })).toThrow('Expected "(" after $all')
    expect(() => compileEntityQuery(relationshipDefinitions, 'User', {
      fields: ['id'],
      where: {
        field: 'pets',
        filters: Array.from({ length: 130 }, () => ({
          field: 'title',
          operator: Operator.Comparison.Equal,
          value: 'Ada',
        })),
        operator: Operator.Comparison.Contains,
      },
    })).toThrow('maximum graph work budget')

    const deep = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [
            { field: 'id', format: 'UUID' },
            { field: 'manager', target: 'User', type: 'Entity' },
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
          ],
          name: 'Pet',
        },
      ],
    }))
    const deepPath = ['owner', ...Array.from({ length: 7 }, () => 'manager'), 'name'].join('.')
    const deepRequirement = (): Readonly<Record<string, unknown>> => ({
      field: deepPath,
      operator: Operator.Comparison.Equal,
      value: 'Ada',
    })
    expect(() => compileEntityQuery(deep, 'User', {
      fields: ['id'],
      where: {
        field: 'pets',
        filters: Array.from({ length: 16 }, deepRequirement),
        operator: Operator.Comparison.Contains,
      },
    })).toThrow('maximum graph work budget')
    expect(() => compileEntityQuery(deep, 'User', {
      fields: ['id'],
      where: {
        field: 'pets',
        filters: Array.from({ length: 4 }, deepRequirement),
        operator: Operator.Comparison.Contains,
      },
    })).not.toThrow()
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
