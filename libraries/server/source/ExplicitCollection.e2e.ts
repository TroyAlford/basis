import { describe, expect, test } from 'bun:test'
import type { LifecycleDatabase } from '../testing/DatabaseLifecycle'
import { withLifecycleDatabase } from '../testing/DatabaseLifecycle'
import { queryEntity } from './Database'
import { EntityDefinitions } from './EntityDefinitions'

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'title', type: 'String' },
        {
          field: 'entries',
          target: 'DeckCardPrinting',
          type: 'Collection',
          via: 'DeckCardPrinting[deck = @]',
        },
        {
          field: 'largeEntries',
          target: 'DeckCardPrinting',
          type: 'Collection',
          via: 'DeckCardPrinting[deck = @ $and quantity > 4]',
        },
        {
          field: 'cards',
          target: 'Card',
          type: 'Collection',
          via: 'DeckCardPrinting[deck = @].card',
        },
      ],
      name: 'Deck',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'title', type: 'String' },
      ],
      name: 'Card',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'title', type: 'String' },
      ],
      name: 'Printing',
    },
  ],
  relationships: [{
    between: [
      { field: 'deck', target: 'Deck' },
      { field: 'card', target: 'Card' },
      { field: 'printing', target: 'Printing' },
    ],
    fields: [
      { field: 'quantity', type: 'Number' },
      { field: 'foil', type: 'Boolean' },
    ],
    name: 'DeckCardPrinting',
  }],
}))

const deckA = '00000000-0000-4000-8000-000000000101'
const deckB = '00000000-0000-4000-8000-000000000102'
const deckC = '00000000-0000-4000-8000-000000000103'
const cardOne = '00000000-0000-4000-8000-000000000111'
const cardTwo = '00000000-0000-4000-8000-000000000112'
const printingOne = '00000000-0000-4000-8000-000000000121'
const printingTwo = '00000000-0000-4000-8000-000000000122'

/**
 * Seed the explicit-collection fixture.
 * @param database - Isolated PostgreSQL database.
 */
async function seed(database: LifecycleDatabase): Promise<void> {
  await database.use(definitions)
  await database.sql`
    INSERT INTO "Entity" ("id", "name", "entity")
    VALUES
      (${deckA}, 'Deck A', 'Deck'),
      (${deckB}, 'Deck B', 'Deck'),
      (${deckC}, 'Deck C', 'Deck'),
      (${cardOne}, 'Card One', 'Card'),
      (${cardTwo}, 'Card Two', 'Card'),
      (${printingOne}, 'Printing One', 'Printing'),
      (${printingTwo}, 'Printing Two', 'Printing')
  `
  await database.sql`
    INSERT INTO "Deck" ("id", "title")
    VALUES
      (${deckA}, 'Deck A'),
      (${deckB}, 'Deck B'),
      (${deckC}, 'Deck C')
  `
  await database.sql`
    INSERT INTO "Card" ("id", "title")
    VALUES
      (${cardOne}, 'Card One'),
      (${cardTwo}, 'Card Two')
  `
  await database.sql`
    INSERT INTO "Printing" ("id", "title")
    VALUES
      (${printingOne}, 'Printing One'),
      (${printingTwo}, 'Printing Two')
  `
  await database.sql`
    INSERT INTO "DeckCardPrinting" ("deck.id", "card.id", "printing.id", "quantity", "foil")
    VALUES
      (${deckA}, ${cardOne}, ${printingOne}, 2, FALSE),
      (${deckA}, ${cardOne}, ${printingTwo}, 5, TRUE),
      (${deckA}, ${cardTwo}, ${printingOne}, 1, FALSE),
      (${deckB}, ${cardTwo}, ${printingTwo}, 9, FALSE)
  `
}

/** One projected record item. */
interface RecordItem {
  readonly card: string,
  readonly deck: string,
  readonly foil: boolean,
  readonly printing: string,
  readonly quantity: number,
}

/** One projected collection envelope. */
interface Envelope<T> {
  readonly $matched: number,
  readonly $total: number,
  readonly items: readonly T[],
}

/** One deck row with projected explicit collections. */
interface DeckRow<T> {
  readonly entries?: Envelope<T>,
  readonly id: string,
  readonly largeEntries?: Envelope<T>,
}

describe('Explicit collections', () => {
  test('projects relationship records with composite identity', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const rows = await queryEntity<DeckRow<RecordItem>>(database.sql, definitions, 'Deck', {
        fields: ['id', 'entries'],
        orderBy: 'id',
        where: { id: deckA },
      })
      expect(rows).toHaveLength(1)
      const entries = rows[0]?.entries
      expect(entries?.$total).toBe(3)
      expect(entries?.$matched).toBe(3)
      expect(entries?.items).toEqual([
        { card: cardOne, deck: deckA, foil: false, printing: printingOne, quantity: 2 },
        { card: cardOne, deck: deckA, foil: true, printing: printingTwo, quantity: 5 },
        { card: cardTwo, deck: deckA, foil: false, printing: printingOne, quantity: 1 },
      ])
    })
  })

  test('projects only records satisfying the authored via predicate', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const rows = await queryEntity<DeckRow<RecordItem>>(database.sql, definitions, 'Deck', {
        fields: ['id', 'largeEntries'],
        orderBy: 'id',
        where: { id: deckA },
      })
      const entries = rows[0]?.largeEntries
      expect(entries?.$total).toBe(1)
      expect(entries?.items).toEqual([
        { card: cardOne, deck: deckA, foil: true, printing: printingTwo, quantity: 5 },
      ])
    })
  })

  test('deduplicates Entity projections by identity after filtering', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const rows = await queryEntity<{
        readonly cards?: Envelope<{ id: string, title: string }>,
        readonly id: string,
      }>(database.sql, definitions, 'Deck', {
        fields: ['id', 'cards.title'],
        orderBy: 'id',
        where: { id: deckA },
      })
      const cards = rows[0]?.cards
      expect(cards?.$total).toBe(2)
      expect(cards?.$matched).toBe(2)
      expect(cards?.items.map(card => card.title)).toEqual(['Card One', 'Card Two'])
    })
  })

  test('counts distinct Entity identities rather than authored edges', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const rows = await queryEntity<{ readonly 'cards.$total': number, readonly 'id': string }>(
        database.sql,
        definitions,
        'Deck',
        { fields: ['id', 'cards.$total'], orderBy: 'id' },
      )
      expect(rows).toEqual([
        { 'cards.$total': 2, 'id': deckA },
        { 'cards.$total': 1, 'id': deckB },
        { 'cards.$total': 0, 'id': deckC },
      ])
    })
  })

  test('applies target and edge predicates to the same qualifying edge', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const matching = await queryEntity<{ id: string }>(database.sql, definitions, 'Deck', {
        fields: ['id'],
        where: `id = '${deckA}' $and ` +
          "cards $contains (title = 'Card One' $and deckCardPrinting.quantity > 4)",
      })
      expect(matching.map(row => row.id)).toEqual([deckA])

      const split = await queryEntity<{ id: string }>(database.sql, definitions, 'Deck', {
        fields: ['id'],
        where: `id = '${deckA}' $and ` +
          "cards $contains (title = 'Card Two' $and deckCardPrinting.quantity > 4)",
      })
      expect(split).toEqual([])
    })
  })

  test('filters records and reports matched counts before paging', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const rows = await queryEntity<DeckRow<RecordItem>>(database.sql, definitions, 'Deck', {
        fields: ['id', 'entries[quantity > 4]'],
        orderBy: 'id',
        where: { id: deckA },
      })
      const entries = rows[0]?.entries
      expect(entries?.$total).toBe(3)
      expect(entries?.$matched).toBe(1)
      expect(entries?.items.map(item => item.quantity)).toEqual([5])
    })
  })

  test('supports record emptiness and membership predicates', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const empty = await queryEntity<{ id: string }>(database.sql, definitions, 'Deck', {
        fields: ['id'],
        orderBy: 'id',
        where: 'entries $empty',
      })
      expect(empty.map(row => row.id)).toEqual([deckC])

      const large = await queryEntity<{ id: string }>(database.sql, definitions, 'Deck', {
        fields: ['id'],
        orderBy: 'id',
        where: 'entries $contains (quantity > 4)',
      })
      expect(large.map(row => row.id)).toEqual([deckA, deckB])
    })
  })
})
