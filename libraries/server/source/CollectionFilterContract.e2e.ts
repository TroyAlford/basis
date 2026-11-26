import { withDatabase } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { DatabaseContext } from '../testing/DatabaseFixture'
import { Action, Graph, Security } from './Graph'
import { compilePolymorphicQuery } from './PolymorphicQuery'

const printing = '00000000-0000-4000-8000-000000000c01'
const deckA = '00000000-0000-4000-8000-000000000c02'
const deckB = '00000000-0000-4000-8000-000000000c03'

const graph = new Graph({
  entities: [
    {
      fields: [{
        field: 'decks',
        target: 'Deck',
        type: 'Collection',
        via: 'DeckPrinting[printing = @].deck',
      }, {
        field: 'entries',
        target: 'DeckPrinting',
        type: 'Collection',
        via: 'DeckPrinting[printing = @]',
      }, {
        field: 'entriesCopy',
        target: 'DeckPrinting',
        type: 'Collection',
        via: 'DeckPrinting[printing = @]',
      }],
      name: 'Printing',
      security: { [Action.Read]: Security.Public },
    },
    {
      fields: [{ field: 'label', type: 'String' }],
      name: 'Deck',
      security: { [Action.Read]: Security.Public },
    },
  ],
  relationships: [{
    between: [{ field: 'printing', target: 'Printing' }, { field: 'deck', target: 'Deck' }],
    fields: [{ field: 'quantity', type: 'Number' }],
    name: 'DeckPrinting',
    security: {
      [Action.Read]: Security.Public,
      [Action.Create]: Security.Public,
    },
  }],
})

describe('flat collection filter contract', () => {
  test('keeps eleven ordered bind positions independently addressable', () => {
    const definition = graph.definitions.entity('Printing')
    if (definition === undefined) throw new Error('Printing definition missing')
    const compiled = compilePolymorphicQuery(graph.definitions, definition, {
      fields: [
        'id',
        `decks[id = '${deckA}']{$limit:2,$offset:7}`,
        'decks.label',
        'entries[quantity = 41]{$limit:3,$offset:11}',
        'entries.quantity',
        'entriesCopy{$limit:4,$offset:17}',
        'entriesCopy.quantity',
      ],
      limit: null,
      where: `id = '${printing}'`,
    })
    expect(compiled.values).toEqual([
      printing,
      deckA,
      deckA,
      7,
      2,
      41,
      41,
      11,
      3,
      17,
      4,
    ])
    expect(compiled.sql).toMatch(/"__ordinal" - \$\d+ BETWEEN 1 AND \$\d+/u)
    const values = [...compiled.values]
    const replace = (from: unknown, first: unknown, second: unknown): void => {
      const positions: number[] = []
      values.forEach((value, index) => { if (value === from) positions.push(index) })
      expect(positions).toHaveLength(2)
      values[positions[0] as number] = first
      values[positions[1] as number] = second
    }
    replace(deckA, deckA, deckB)
    replace(41, 41, 42)
    expect(new Set(values).size).toBe(11)
  })

  test('keeps entity and record item/count filters independently bound', async () => {
    await withDatabase('flat-filter-contract', null, async database => {
      const definition = database.entities.entity('Printing')
      if (definition === undefined) throw new Error('Printing definition missing')
      const options = {
        fields: [
          'id',
          `decks[id = '${deckA}']{$limit:null}`,
          'decks.label',
          'entries[quantity = 41]{$limit:null}',
          'entries.quantity',
        ],
        limit: null,
      }
      const compiled = compilePolymorphicQuery(database.entities, definition, options)
      const indexOf = (value: unknown): number[] => {
        const result: number[] = []
        compiled.values.forEach((candidate, index) => { if (candidate === value) result.push(index) })
        return result
      }
      const deckPositions = indexOf(deckA)
      const entryPositions = indexOf(41)
      expect(deckPositions).toHaveLength(2)
      expect(entryPositions).toHaveLength(2)
      const run = async (
        itemDeck: string,
        matchedDeck: string,
        itemQuantity: number,
        matchedQuantity: number,
      ): Promise<Record<string, unknown>> => {
        const values = [...compiled.values]
        values[deckPositions[0] as number] = itemDeck
        values[deckPositions[1] as number] = matchedDeck
        values[entryPositions[0] as number] = itemQuantity
        values[entryPositions[1] as number] = matchedQuantity
        const rows = await database.sql.unsafe<Record<string, unknown>[]>(compiled.sql, values)
        return compiled.hydrate(rows[0] as Record<string, unknown>)
      }
      const independent = await run(deckA, deckB, 41, 42) as {
        decks: { $matched: number, $total: number, items: { label: string }[] },
        entries: { $matched: number, $total: number, items: { quantity: number }[] },
      }
      expect(independent.decks.items.map(item => item.label)).toEqual(['A'])
      expect(independent.decks.$matched).toBe(1)
      expect(independent.decks.$total).toBe(2)
      expect(independent.entries.items.map(item => item.quantity)).toEqual([41])
      expect(independent.entries.$matched).toBe(1)
      expect(independent.entries.$total).toBe(2)
      const emptyItems = await run('00000000-0000-4000-8000-000000000c99', deckB, 99, 42) as typeof independent
      expect(emptyItems.decks.items).toEqual([])
      expect(emptyItems.decks.$matched).toBe(1)
      expect(emptyItems.decks.$total).toBe(2)
      expect(emptyItems.entries.items).toEqual([])
      expect(emptyItems.entries.$matched).toBe(1)
      expect(emptyItems.entries.$total).toBe(2)
      const reverse = await run(deckB, '00000000-0000-4000-8000-000000000c99', 42, 99) as typeof independent
      expect(reverse.decks.items.map(item => item.label)).toEqual(['B'])
      expect(reverse.decks.$matched).toBe(0)
      expect(reverse.decks.$total).toBe(2)
      expect(reverse.entries.items.map(item => item.quantity)).toEqual([42])
      expect(reverse.entries.$matched).toBe(0)
      expect(reverse.entries.$total).toBe(2)
      const expected = readFileSync(new URL('./FlatFilteredCollection.expected.sql', import.meta.url), 'utf8')
      expect(compiled.sql.replace(/\), "/gu, '),\n"')).toMatchIndented(expected)
    }, {
      graph,
      setup: async (database: DatabaseContext) => {
        await database.create('Printing', { id: printing, name: 'Printing' })
        await database.create('Deck', [
          { id: deckA, label: 'A', name: 'A' },
          { id: deckB, label: 'B', name: 'B' },
        ])
        await database.sql`
          INSERT INTO "DeckPrinting" ("printing.id", "deck.id", "quantity")
          VALUES (${printing}, ${deckA}, 41), (${printing}, ${deckB}, 42)
        `
      },
    })
  })
})
