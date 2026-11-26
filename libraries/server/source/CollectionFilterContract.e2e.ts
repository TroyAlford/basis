import { withDatabase } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import type { DatabaseContext } from '../testing/DatabaseFixture'
import { compileEntityQuery } from './Database'
import { Action, Graph, Security } from './Graph'

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
    fields: [],
    name: 'DeckPrinting',
    security: {
      [Action.Read]: Security.Public,
      [Action.Create]: Security.Public,
    },
  }],
})

describe('flat collection filter contract', () => {
  test('keeps item and matched-count filters independently bound', async () => {
    await withDatabase('flat-filter-contract', null, async database => {
      const options = {
        fields: ['id', "decks[label = 'A']{$limit:null}", 'decks.label'],
        limit: null,
      }
      const compiled = compileEntityQuery(database.entities, 'Printing', options)
      const values = [...compiled.values]
      const positions = values.flatMap((value, index) => (value === 'A' ? [index] : []))
      expect(positions).toHaveLength(2)
      values[positions[0] as number] = 'A'
      values[positions[1] as number] = 'B'
      const rows = await database.sql.unsafe<Record<string, unknown>[]>(compiled.sql, values)
      const row = rows[0]
      const items = typeof row.decks === 'string' ? JSON.parse(row.decks) : row.decks
      expect(items.map((item: { label: string }) => item.label)).toEqual(['A'])
      expect(Number(row.decks__matched)).toBe(1)
      expect(Number(row.decks__total)).toBe(2)
    }, {
      graph,
      setup: async (database: DatabaseContext) => {
        await database.create('Printing', { id: printing, name: 'Printing' })
        await database.create('Deck', [
          { id: deckA, label: 'A', name: 'A' },
          { id: deckB, label: 'B', name: 'B' },
        ])
        await database.sql`
          INSERT INTO "DeckPrinting" ("printing.id", "deck.id")
          VALUES (${printing}, ${deckA}), (${printing}, ${deckB})
        `
      },
    })
  })
})
