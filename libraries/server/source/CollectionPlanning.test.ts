import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { compileEntityQuery } from './Database'
import { Graph } from './Graph'

const graph = new Graph({
  entities: [
    {
      fields: [
        { field: 'title', type: 'String' },
        { field: 'enabled', type: 'Boolean' },
        { field: 'card', target: 'Card', type: 'Entity' },
        {
          cardinality: 'Many',
          field: 'panels',
          inverse: 'printing',
          target: 'Panel',
          type: 'Inverse',
        },
      ],
      name: 'Printing',
    },
    {
      fields: [
        {
          cardinality: 'Many',
          field: 'faces',
          inverse: 'card',
          target: 'Face',
          type: 'Inverse',
        },
      ],
      name: 'Card',
    },
    {
      fields: [{ field: 'card', inverse: 'faces', target: 'Card', type: 'Entity' }],
      name: 'Face',
    },
    {
      fields: [
        { field: 'printing', inverse: 'panels', target: 'Printing', type: 'Entity' },
        { field: 'art', target: 'Art', type: 'Entity' },
      ],
      name: 'Panel',
    },
    { fields: [], name: 'Art' },
    {
      fields: [{
        field: 'printings',
        target: 'Printing',
        type: 'Collection',
        via: 'DeckPrinting[deck = @].printing',
      }],
      name: 'Deck',
    },
  ],
  relationships: [{
    between: [
      { field: 'deck', target: 'Deck' },
      { field: 'printing', target: 'Printing' },
    ],
    fields: [{ field: 'quantity', type: 'Number' }],
    name: 'DeckPrinting',
  }],
})

const fields = [
  'id',
  'printings{$limit:null}',
  'printings.quantity',
  'printings.card',
  'printings.card.name',
  'printings.card.faces{$limit:null}',
  'printings.card.faces.name',
  'printings.panels{$limit:null}',
  'printings.panels.art.name',
]

/**
 * Count regex matches in generated SQL.
 * @param sql - Generated SQL.
 * @param pattern - Pattern to count.
 * @returns Match count.
 */
function count(sql: string, pattern: RegExp): number {
  return (sql.match(pattern) ?? []).length
}

/**
 * Extract complete `SELECT count(*)` subqueries with balanced parentheses.
 * @param sql - Generated SQL.
 * @returns The count subqueries.
 */
function countSubqueries(sql: string): string[] {
  const marker = 'SELECT count(*)::int FROM ('
  const result: string[] = []
  let cursor = 0
  while (true) {
    const start = sql.indexOf(marker, cursor)
    if (start === -1) return result
    let index = start + marker.length
    let depth = 1
    let quote: string | undefined
    while (index < sql.length && depth > 0) {
      const char = sql[index]
      if (quote !== undefined) {
        if (char === quote && sql[index - 1] !== '\\') quote = undefined
      } else if (char === '\'' || char === '"') {
        quote = char
      } else if (char === '(') {
        depth += 1
      } else if (char === ')') {
        depth -= 1
      }
      index += 1
    }
    result.push(sql.slice(start, index))
    cursor = index
  }
}

describe('collection planning', () => {
  test('a collection filter does not duplicate the nested item projection for counts', () => {
    const filtered = compileEntityQuery(graph.definitions, 'Deck', {
      fields: ['id', 'printings[title = \'One\']{$limit:null}', 'printings.card.name'],
    })
    expect(filtered.sql).toContain('batch_rows_all_bg5')
    expect(filtered.sql).toContain('batch_rows_filtered_bg5')
    expect(filtered.sql).not.toMatch(/SELECT count\(\*\)::int FROM \(/)
  })

  test('an edge projection does not duplicate target traversal', () => {
    const edge = compileEntityQuery(graph.definitions, 'Deck', {
      fields: ['id', 'printings{$limit:null}', 'printings.quantity', 'printings.card.name'],
    })
    expect(count(edge.sql, /"Card"/g)).toBe(1)
    expect(count(edge.sql, /json_build_object\( 'quantity'/g)).toBe(1)
    const edgeProjection = edge.sql.slice(
      edge.sql.indexOf('json_build_object'),
      edge.sql.indexOf('AS "__edge"'),
    )
    expect(edgeProjection).toContain('FROM  "DeckPrinting"')
    expect(edgeProjection).not.toContain('JOIN "Printing"')
    expect(edgeProjection).not.toContain('JOIN "Entity"')
  })

  test('keeps total and matched counts over their correct row sets', () => {
    const { sql, values } = compileEntityQuery(graph.definitions, 'Deck', {
      fields: [
        'id',
        "printings[title = 'One']{$limit:2,$offset:1}",
        'printings.card.name',
      ],
    })
    expect(sql).toContain('batch_rows_all_bg5')
    expect(sql).toContain('batch_rows_filtered_bg5')
    expect(sql).toContain('batch_counts_bg5')
    expect(sql).toContain('"__total"')
    expect(sql).toContain('"__matched"')
    expect(sql).toContain('"__ordinal" > 1')
    expect(sql).toContain('"__ordinal" <= 3')
    expect(values).toEqual(['One', 25, 0])
  })

  test('does not expand nested resources for matched or total counts', () => {
    const { sql } = compileEntityQuery(graph.definitions, 'Deck', {
      fields: [
        'id',
        "printings[title = 'One']{$limit:null}",
        'printings.card.faces{$limit:null}',
        'printings.card.faces.name',
        'printings.panels{$limit:null}',
        'printings.panels.art.name',
      ],
    })
    const scopes = countSubqueries(sql)
    expect(scopes.length).toBeGreaterThan(1)
    for (const scope of scopes) {
      expect(scope).not.toMatch(/"Card"|"Art"/)
    }
  })

  test('keeps quantity on the collection edge', () => {
    const { sql } = compileEntityQuery(graph.definitions, 'Deck', {
      fields: ['id', 'printings{$limit:null}', 'printings.quantity', 'printings.card.name'],
    })
    expect(sql).toContain('json_build_object( \'quantity\', "cj')
    expect(sql).toContain('"cj3"."deck.id" = "t"."id"')
    expect(sql).toContain('"cj3"."printing.id" = "__child"."id"')
  })

  test('extracts balanced count scopes without parsing quoted parentheses', () => {
    const sample = [
      'SELECT count(*)::int FROM (',
      'SELECT \'literal ) with ( parens\' AS "odd)column", ',
      '\'it\'\'s (still) literal\' FROM t)',
    ].join('')
    expect(countSubqueries(sample)).toEqual([sample])
  })

  test('keeps independently filtered uses of one collection isolated', () => {
    const compiled = compileEntityQuery(graph.definitions, 'Deck', {
      fields: ['id', "printings[title = 'A']{$limit:null}", 'printings.title'],
      where: 'printings $contains (enabled = true)',
    })
    expect(compiled.sql).toContain('"title"')
    expect(compiled.sql).toContain('"enabled"')
    expect(compiled.values).toEqual([true, 'A', true, 25, 0])
    expect(countSubqueries(compiled.sql).every(scope => (
      !scope.includes('"Card"') && !scope.includes('"Face"')
    ))).toBe(true)
  })

  test('existence does not project nested item fields', () => {
    const exists = compileEntityQuery(graph.definitions, 'Deck', {
      fields: ['id'],
      where: "printings $contains (card.name = 'One')",
    })
    expect(exists.sql).not.toContain('panels')
    expect(exists.sql).not.toContain('faces')
  })

  test('count and item outputs remain deterministic', () => {
    const options = {
      fields,
      where: { id: randomUUID() },
    } as const
    const first = compileEntityQuery(graph.definitions, 'Deck', options)
    const second = compileEntityQuery(graph.definitions, 'Deck', options)
    expect(first).toEqual(second)
  })
})

test('unrelated entity definitions do not change concrete collection SQL', () => {
  const createGraph = (unrelated: number): Graph => new Graph({
    entities: [
      {
        fields: [{
          field: 'printings',
          target: 'Printing',
          type: 'Collection',
          via: 'DeckPrinting[deck = @].printing',
        }],
        name: 'Deck',
      },
      { fields: [{ field: 'title', type: 'String' }], name: 'Printing' },
      ...Array.from({ length: unrelated }, (_, index) => ({
        fields: [{ field: 'label', type: 'String' }],
        name: `Unrelated${index}`,
      })),
    ] as never,
    relationships: [{
      between: [
        { field: 'deck', target: 'Deck' },
        { field: 'printing', target: 'Printing' },
      ],
      fields: [{ field: 'quantity', type: 'Number' }],
      name: 'DeckPrinting',
    }],
  })
  const normalize = (sql: string): string => sql.replace(/"[a-z]+\d+"/g, '"alias"')
  const small = compileEntityQuery(createGraph(0).definitions, 'Deck', {
    fields: ['id', 'printings{$limit:null}', 'printings.title'],
  })
  const large = compileEntityQuery(createGraph(20).definitions, 'Deck', {
    fields: ['id', 'printings{$limit:null}', 'printings.title'],
  })
  expect(normalize(large.sql)).toBe(normalize(small.sql))
})

describe('chosen collection compilation', () => {
  test('batches an unfiltered root collection by parent identity', () => {
    const batchGraph = new Graph({
      entities: [
        {
          fields: [
            { field: 'label', type: 'String' },
            { field: 'items', target: 'CollectionItem', type: 'Collection', via: 'RootItem[root = @].item' },
            { field: 'entries', target: 'RootItem', type: 'Collection', via: 'RootItem[root = @]' },
          ],
          name: 'CollectionRoot',
        },
        { fields: [{ field: 'label', type: 'String' }], name: 'CollectionItem' },
      ],
      relationships: [{
        between: [
          { field: 'root', target: 'CollectionRoot' },
          { field: 'item', target: 'CollectionItem' },
        ],
        fields: [{ field: 'quantity', type: 'Number' }],
        name: 'RootItem',
      }],
    })
    const { sql } = compileEntityQuery(batchGraph.definitions, 'CollectionRoot', {
      fields: ['id', 'items{$limit:null}', 'items.label'],
    })
    expect(sql).not.toContain('LEFT JOIN LATERAL')
    const expectedBatch = [
      'WITH "authorized_CollectionRoot" AS NOT MATERIALIZED (SELECT "root"."id" AS "id" FROM "CollectionRoo',
      't" "leaf" JOIN "Entity" "root" ON "root"."id" = "leaf"."id"), "authorized_CollectionItem" AS NOT MAT',
      'ERIALIZED (SELECT "root"."id" AS "id", NULL AS "root.id" FROM "CollectionItem" "leaf" JOIN "Entity" ',
      '"root" ON "root"."id" = "leaf"."id"), "batch_roots_bg5" AS MATERIALIZED (SELECT "t"."id" AS "id" FRO',
      'M "authorized_CollectionRoot" "t"), "batch_rows_all_bg5" AS MATERIALIZED (SELECT "cj3"."root.id" AS ',
      '"__parent_id", "__child".* FROM "RootItem" "cj3" JOIN "authorized_CollectionItem" "ct1" ON "ct1"."id',
      '" = "cj3"."item.id" JOIN "batch_roots_bg5" "t" ON TRUE JOIN (WITH "authorized_batch_CollectionItem" ',
      'AS NOT MATERIALIZED (SELECT "root"."entity" AS "entity", "root"."id" AS "id", "leaf"."label" AS "lab',
      'el", "root"."name" AS "name" FROM "CollectionItem" "leaf" JOIN "Entity" "root" ON "root"."id" = "lea',
      'f"."id") SELECT b4."id" AS "id", b4."name" AS "name", b4."entity" AS "entity", b4."label" AS "label"',
      ' FROM "authorized_batch_CollectionItem" "b4"  ) AS "__child" ON "__child"."id" = "ct1"."id" WHERE "c',
      'j3"."root.id" = "t"."id"), "batch_counts_bg5" AS MATERIALIZED (SELECT "__parent_id", count(*)::int A',
      'S "__total" FROM "batch_rows_all_bg5" GROUP BY "__parent_id"), "batch_items_bg5" AS MATERIALIZED (SE',
      'LECT "__parent_id", COALESCE(json_agg(row_to_json("__item") ORDER BY "__item"."__ordinal") FILTER (W',
      'HERE "__ordinal" > 0), \'[]\'::json) AS "__items", count(*)::int AS "__matched" FROM (SELECT "__parent',
      '_id", row_number() OVER (PARTITION BY "__parent_id" ORDER BY "__child"."id") AS "__ordinal", "__chil',
      'd".* FROM "batch_rows_all_bg5" AS "__child") AS "__item" GROUP BY "__parent_id") SELECT t."id" AS "i',
      'd", "bc6"."__items" AS "items", "bc6"."__matched" AS "items__matched", "bn7"."__total" AS "items__to',
      'tal" FROM "authorized_CollectionRoot" "t" LEFT JOIN "batch_items_bg5" "bc6" ON "bc6"."__parent_id" =',
      ' "t"."id" LEFT JOIN "batch_counts_bg5" "bn7" ON "bn7"."__parent_id" = "t"."id"   LIMIT $1 OFFSET $2',
    ].join('')
    expect(sql).toMatchIndented(expectedBatch)

    const scoped = compileEntityQuery(batchGraph.definitions, 'CollectionRoot', {
      fields: ['id', 'items{$limit:null}', 'items.label'],
      where: "label = 'One'",
    })
    expect(scoped.sql).toContain(
      '"batch_roots_bg5" AS MATERIALIZED (SELECT "t"."id" AS "id" ' +
      'FROM "authorized_CollectionRoot" "t" WHERE t."label" IS NOT DISTINCT FROM $1)',
    )
    expect(scoped.sql).toContain('WHERE t."label" IS NOT DISTINCT FROM $2')
    expect(scoped.values).toEqual(['One', 'One', 25, 0])

    const edge = compileEntityQuery(batchGraph.definitions, 'CollectionRoot', {
      fields: ['id', 'items{$limit:null}', 'items.label', 'items.quantity'],
    })
    expect(edge.sql).toContain(' AS "__edge"')
    expect(edge.sql).toContain('json_build_object')

    const record = compileEntityQuery(batchGraph.definitions, 'CollectionRoot', {
      fields: ['id', 'entries{$limit:null}', 'entries.quantity'],
    })
    expect(record.sql).toContain('batch_rows_all_')
    expect(record.sql).toContain('json_build_object("quantity"')
    expect(record.sql).not.toContain('LEFT JOIN LATERAL')
  })
})
