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
    const scopes = countSubqueries(filtered.sql)
    expect(scopes).toHaveLength(2)
    for (const scope of scopes) {
      expect(scope).not.toMatch(/"Card"|"Art"/)
    }
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
    const countScopes = countSubqueries(sql)
    expect(countScopes).toHaveLength(2)
    expect(countScopes[0]).toContain('ct1."title"')
    expect(countScopes[1]).not.toContain('ct1."title"')
    for (const scope of countScopes) {
      expect(scope).not.toMatch(/"Card"|"Face"|"Panel"|"Art"/)
    }
    expect((sql.match(/OFFSET/g) ?? [])).toHaveLength(2)
    expect(values).toEqual(['One', 2, 1, 'One', 25, 0])
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
    expect(compiled.values).toEqual(['A', 'A', true, 25, 0])
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
