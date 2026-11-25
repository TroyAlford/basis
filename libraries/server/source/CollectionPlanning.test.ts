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
    expect(filtered.sql).toContain('flat_rows_')
    expect(filtered.sql).toContain('flat_rows_filtered_')
    expect(filtered.sql).toContain('flat_flags_')
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
    expect(sql).toContain('flat_rows_')
    expect(sql).toContain('flat_rows_filtered_')
    expect(sql).toContain('flat_counts_')
    expect(sql).toContain('"__total"')
    expect(sql).toContain('"__matched"')
    expect(sql).toContain('"__ordinal" > 1')
    expect(sql).toContain('"__ordinal" <= 3')
    expect(values).toEqual([25, 0, 'One'])
  })

  test('batches nested counts without expanding nested resources', () => {
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
    expect(countSubqueries(sql)).toEqual([])
    expect(sql.match(/flat_counts_/gu)?.length).toBeGreaterThan(1)
    expect(sql).toContain('batch_selected_roots_')
    expect(sql.match(/flat_base_/gu)?.length).toBeGreaterThan(2)
    expect(sql).toMatch(/batch_parent_/u)
    expect(sql).not.toContain('LEFT JOIN LATERAL')
  })

  test('keeps quantity on the collection edge', () => {
    const { sql } = compileEntityQuery(graph.definitions, 'Deck', {
      fields: ['id', 'printings{$limit:null}', 'printings.quantity', 'printings.card.name'],
    })
    expect(sql).toContain('json_build_object( \'quantity\', "cj')
    expect(sql).toContain('"cj3"."deck.id" = "t"."id"')
    expect(sql).toMatch(/"cj3"\."printing\.id" = "ct\d+"\."id"/u)
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
    expect(compiled.values).toEqual([true, 25, 0, 'A'])
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

  test('batches an inverse collection without a relationship table', () => {
    const inverse = compileEntityQuery(graph.definitions, 'Printing', {
      fields: ['id', 'panels{$limit:null}', 'panels.art.name'],
    })
    expect(inverse.sql).toContain('flat_base_')
    expect(inverse.sql).not.toContain('LEFT JOIN LATERAL')
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

describe('flattened collection compilation', () => {
  test('materializes selected root rows and distinct relationship targets once', () => {
    const { sql } = compileEntityQuery(graph.definitions, 'Deck', {
      fields: ['id', 'printings{$limit:null}', 'printings.card.name'],
    })
    expect(count(sql, /"batch_selected_rows_\d+" AS MATERIALIZED/gu)).toBe(1)
    expect(count(sql, /"batch_selected_roots_\d+" AS MATERIALIZED/gu)).toBe(1)
    expect(count(sql, /"batch_source_\w+" AS MATERIALIZED/gu)).toBe(1)
    expect(count(sql, /"flat_targets_\w+" AS MATERIALIZED/gu)).toBe(1)
    expect(sql).toMatch(/SELECT "ct\d+"\.\* FROM "authorized_\w+" "ct\d+" WHERE "ct\d+"\."id" IN/u)
    expect(count(sql, /"authorized_Deck" AS MATERIALIZED/gu)).toBe(1)
    expect(sql).toMatch(/FROM "batch_selected_rows_\d+" "t" LEFT JOIN/u)
  })

  test('emits one shared base and aggregate chain per collection path', () => {
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
    expect(sql).not.toContain('LEFT JOIN LATERAL')
    expect(sql).not.toContain('authorized_batch_')
    expect(sql).not.toContain('authorized_nested_')
    expect(count(sql, /"flat_base_\w+" AS MATERIALIZED/gu)).toBe(3)
    expect(count(sql, /"flat_flags_\w+" AS MATERIALIZED/gu)).toBe(1)
    expect(count(sql, /"flat_rows_(?!filtered_)\w+" AS MATERIALIZED/gu)).toBe(3)
    expect(count(sql, /"flat_counts_\w+" AS MATERIALIZED/gu)).toBe(3)
    expect(count(sql, /"flat_items_\w+" AS MATERIALIZED/gu)).toBe(3)
    expect(count(sql, /"authorized_Card" AS MATERIALIZED/gu)).toBe(1)
    expect(count(sql, /"authorized_Panel" AS MATERIALIZED/gu)).toBe(1)
    expect(count(sql, /"authorized_Face" AS MATERIALIZED/gu)).toBe(1)
  })
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
    expect(sql).toContain('"batch_selected_rows_0" AS MATERIALIZED')
    expect(sql).toContain('"batch_selected_roots_1" AS MATERIALIZED')
    expect(sql).toMatch(
      /"batch_source_\w+" AS MATERIALIZED \(SELECT "cj\d+"\."root\.id" AS "__parent_id", /u,
    )
    expect(sql).toMatch(/"flat_targets_\w+" AS MATERIALIZED/u)
    expect(sql).toMatch(/"flat_base_\w+" AS MATERIALIZED/u)
    expect(sql).toMatch(/"ct\d+"\."id" AS "__item_id"/u)
    expect(sql).toMatch(/"flat_rows_\w+" AS MATERIALIZED \(SELECT DISTINCT ON \(/u)
    expect(sql).toMatch(/"flat_counts_\w+" AS MATERIALIZED/u)
    expect(sql).toMatch(/"flat_items_\w+" AS MATERIALIZED/u)
    expect(sql).not.toContain('authorized_batch_')

    const scoped = compileEntityQuery(batchGraph.definitions, 'CollectionRoot', {
      fields: ['id', 'items{$limit:null}', 'items.label'],
      where: "label = 'One'",
    })
    expect(scoped.sql).toContain('"batch_selected_rows_0" AS MATERIALIZED')
    expect(scoped.sql).toContain('SELECT "t".* FROM "authorized_CollectionRoot" "t"')
    expect(scoped.sql).toContain('WHERE t."label" IS NOT DISTINCT FROM $1')
    expect(scoped.sql).toMatch(/LIMIT \$2 OFFSET \$3/u)
    expect(scoped.sql).toMatch(/JOIN "batch_selected_roots_1" "t" ON TRUE/u)
    expect(scoped.values).toEqual(['One', 25, 0])

    const edge = compileEntityQuery(batchGraph.definitions, 'CollectionRoot', {
      fields: ['id', 'items{$limit:null}', 'items.label', 'items.quantity'],
    })
    expect(edge.sql).toContain(' AS "__edge"')
    expect(edge.sql).toContain('json_build_object')

    const record = compileEntityQuery(batchGraph.definitions, 'CollectionRoot', {
      fields: ['id', 'entries{$limit:null}', 'entries.quantity'],
    })
    expect(record.sql).toContain('flat_base_')
    expect(record.sql).toContain("json_build_object('quantity'")
    expect(record.sql).not.toContain('LEFT JOIN LATERAL')
  })
})
