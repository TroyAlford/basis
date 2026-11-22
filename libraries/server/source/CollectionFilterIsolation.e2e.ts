import { expect, setDefaultTimeout, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { DatabaseTestOptions } from '../testing/DatabaseFixture'
import { withDatabase } from '../testing/DatabaseFixture'
import { Action, Graph, Security } from './Graph'

setDefaultTimeout(60_000)

const deck = randomUUID()
const p1 = randomUUID()
const p2 = randomUUID()
const p3 = randomUUID()

const publicRead = { [Action.Read]: Security.Public } as const
const graph = new Graph({
  entities: [
    {
      fields: [{
        field: 'printings',
        target: 'Printing',
        type: 'Collection',
        via: 'DeckPrinting[deck = @].printing',
      }],
      name: 'Deck',
      security: publicRead,
    },
    {
      fields: [
        { field: 'title', type: 'String' },
        { field: 'enabled', type: 'Boolean' },
      ],
      name: 'Printing',
      security: publicRead,
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
  security: { DeckPrinting: publicRead },
})

const options: DatabaseTestOptions = {
  graph,
  setup: async database => {
    await database.create('Deck', { id: deck, name: 'Filter Deck' })
    await database.create('Printing', [
      { enabled: false, id: p1, name: 'P1', title: 'A' },
      { enabled: true, id: p2, name: 'P2', title: 'B' },
      { enabled: true, id: p3, name: 'P3', title: 'A' },
    ])
    await database.sql`
      INSERT INTO "DeckPrinting" ("deck.id", "printing.id", "quantity")
      VALUES
        (${deck}, ${p1}, 1),
        (${deck}, ${p2}, 1),
        (${deck}, ${p3}, 1)
    `
  },
}

test('evaluates independently filtered uses of one collection navigation', async () => {
  await withDatabase('collection-filter-isolation', null, async database => {
    const [row] = await database.query<{
      printings: {
        $matched: number,
        $total: number,
        items: { id: string, title: string }[],
      },
    }>('Deck', {
      fields: ['id', "printings[title = 'A']{$limit:null}", 'printings.title'],
      where: 'printings $contains (enabled = true)',
    })
    expect(row?.printings.$matched).toBe(2)
    expect(row?.printings.$total).toBe(3)
    expect(row?.printings.items.map(item => item.id).sort()).toEqual([p1, p3].sort())
  }, options)
})
