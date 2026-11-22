import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { compileEntityQuery } from './Database'
import { Graph } from './Graph'

const graph = new Graph({
  entities: [
    {
      fields: [
        { field: 'title', type: 'String' },
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

describe('collection planning', () => {
  test('a collection filter does not duplicate the nested item projection for counts', () => {
    const filtered = compileEntityQuery(graph.definitions, 'Deck', {
      fields: ['id', 'printings[title = \'One\']{$limit:null}', 'printings.card.name'],
    })
    expect(count(filtered.sql, /\("Card"/g)).toBe(1)
    expect(count(filtered.sql, /\("Panel"/g)).toBe(0)
  })

  test('an edge projection does not duplicate target traversal', () => {
    const edge = compileEntityQuery(graph.definitions, 'Deck', {
      fields: ['id', 'printings{$limit:null}', 'printings.quantity', 'printings.card.name'],
    })
    expect(count(edge.sql, /\("Card"/g)).toBe(1)
    expect(count(edge.sql, /json_build_object\( 'quantity'/g)).toBe(1)
  })

  test('keeps total and matched counts over their correct row sets', () => {
    const { sql } = compileEntityQuery(graph.definitions, 'Deck', {
      fields: [
        'id',
        "printings[title = 'One']{$limit:2,$offset:1}",
        'printings.card.name',
      ],
    })
    const [matched, total] = sql.split('AS "__matched"')
    expect(matched).toContain('ct1."title"')
    expect(total).toContain('AS "__total"')
    expect(total).not.toContain('ct1."title"')
    expect((sql.match(/OFFSET/g) ?? [])).toHaveLength(2)
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
    expect((sql.match(/\("Card"/g) ?? [])).toHaveLength(1)
    // Item + its identity-only matched count; no second full item projection.
    expect((sql.match(/FROM "Face"/g) ?? []).length).toBeLessThanOrEqual(2)
    expect((sql.match(/FROM "Panel"/g) ?? []).length).toBeLessThanOrEqual(2)
    expect((sql.match(/\("Art"/g) ?? []).length).toBeLessThanOrEqual(2)
  })

  test('keeps quantity on the collection edge', () => {
    const { sql } = compileEntityQuery(graph.definitions, 'Deck', {
      fields: ['id', 'printings{$limit:null}', 'printings.quantity', 'printings.card.name'],
    })
    expect(sql).toContain('json_build_object( \'quantity\', "cj')
    expect(sql).toContain('"cj3"."deck.id" = "t"."id"')
    expect(sql).toContain('"cj3"."printing.id" = "__child"."id"')
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
