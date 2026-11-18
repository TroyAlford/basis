import { describe, expect, test } from 'bun:test'
import type { LifecycleDatabase } from '../testing/DatabaseLifecycle'
import { withLifecycleDatabase } from '../testing/DatabaseLifecycle'
import { compileEntityQuery, queryEntity } from './Database'
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
        {
          field: 'pagedEntries',
          target: 'DeckCardPrinting',
          type: 'Collection',
          via: 'DeckCardPrinting[deck = @]{$limit:1,$offset:1,$orderBy:-quantity}',
        },
        {
          field: 'pagedCards',
          target: 'Card',
          type: 'Collection',
          via: 'DeckCardPrinting[deck = @]{$limit:1,$offset:1,$orderBy:-title}.card',
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

  test('agrees between root count predicates and projected envelopes', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const total = await queryEntity<{ id: string }>(database.sql, definitions, 'Deck', {
        fields: ['id'],
        orderBy: 'id',
        where: 'cards.$total = 2',
      })
      expect(total.map(row => row.id)).toEqual([deckA])

      const matched = await queryEntity<{ id: string }>(database.sql, definitions, 'Deck', {
        fields: ['id'],
        orderBy: 'id',
        where: "cards[title = 'Card One'].$matched = 1",
      })
      expect(matched.map(row => row.id)).toEqual([deckA])

      const filteredEmpty = await queryEntity<{ id: string }>(database.sql, definitions, 'Deck', {
        fields: ['id'],
        orderBy: 'id',
        where: "cards[title = 'Missing'].$matched = 0",
      })
      expect(filteredEmpty.map(row => row.id)).toEqual([deckA, deckB, deckC])
    })
  })

  test('counts record identities and ignores member filters for totals', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const rows = await queryEntity<{
        readonly 'entries.$total': number,
        readonly 'id': string,
        readonly 'largeEntries.$total': number,
      }>(database.sql, definitions, 'Deck', {
        fields: ['id', 'entries.$total', 'largeEntries.$total'],
        orderBy: 'id',
      })
      expect(rows).toEqual([
        { 'entries.$total': 3, 'id': deckA, 'largeEntries.$total': 1 },
        { 'entries.$total': 1, 'id': deckB, 'largeEntries.$total': 1 },
        { 'entries.$total': 0, 'id': deckC, 'largeEntries.$total': 0 },
      ])

      const matched = await queryEntity<{ id: string }>(database.sql, definitions, 'Deck', {
        fields: ['id'],
        orderBy: 'id',
        where: 'entries[quantity > 4].$matched = 1',
      })
      expect(matched.map(row => row.id)).toEqual([deckA, deckB])

      const ignoredFilter = await queryEntity<{ id: string }>(database.sql, definitions, 'Deck', {
        fields: ['id'],
        orderBy: 'id',
        where: 'entries[quantity > 100].$total = 1',
      })
      expect(ignoredFilter.map(row => row.id)).toEqual([deckB])
    })
  })

  test('agrees between record and Entity collection membership predicates', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const records = await queryEntity<{ id: string }>(database.sql, definitions, 'Deck', {
        fields: ['id'],
        orderBy: 'id',
        where: 'entries $contains (quantity > 4)',
      })
      const entities = await queryEntity<{ id: string }>(database.sql, definitions, 'Deck', {
        fields: ['id'],
        orderBy: 'id',
        where: 'cards $contains (deckCardPrinting.quantity > 4)',
      })
      expect(entities).toEqual(records)
    })
  })

  test('filters Entity projections through qualifying edges', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const query = async (filter: string) => {
        const rows = await queryEntity<{
          readonly cards: Envelope<{ readonly title: string }>,
          readonly id: string,
        }>(database.sql, definitions, 'Deck', {
          fields: ['id', `cards[${filter}]`, 'cards.title'],
          orderBy: 'id',
          where: { id: deckA },
        })
        return rows[0]?.cards
      }

      const positive = await query('deckCardPrinting.quantity > 4')
      expect(positive?.$matched).toBe(1)
      expect(positive?.$total).toBe(2)
      expect(positive?.items.map(item => item.title)).toEqual(['Card One'])

      const negative = await query('deckCardPrinting.quantity > 6')
      expect(negative?.$matched).toBe(0)
      expect(negative?.$total).toBe(2)
      expect(negative?.items).toEqual([])

      const mixedPositive = await query(
        "title = 'Card One' $and deckCardPrinting.quantity > 4",
      )
      expect(mixedPositive?.$matched).toBe(1)
      expect(mixedPositive?.$total).toBe(2)

      const mixedNegative = await query(
        "title = 'Card Two' $and deckCardPrinting.quantity > 4",
      )
      expect(mixedNegative?.$matched).toBe(0)
      expect(mixedNegative?.$total).toBe(2)
    })
  })

  test('applies authored ordering and paging with query-time overrides', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const records = await queryEntity<{
        readonly id: string,
        readonly pagedEntries: Envelope<RecordItem>,
      }>(database.sql, definitions, 'Deck', {
        fields: ['id', 'pagedEntries'],
        where: { id: deckA },
      })
      expect(records[0]?.pagedEntries.$total).toBe(3)
      expect(records[0]?.pagedEntries.items.map(item => item.quantity)).toEqual([2])

      const recordOverride = await queryEntity<{
        readonly id: string,
        readonly pagedEntries: Envelope<RecordItem>,
      }>(database.sql, definitions, 'Deck', {
        fields: ['id', 'pagedEntries{$limit:2,$offset:0,$orderBy:quantity}'],
        where: { id: deckA },
      })
      expect(recordOverride[0]?.pagedEntries.$total).toBe(3)
      expect(recordOverride[0]?.pagedEntries.items.map(item => item.quantity)).toEqual([1, 2])

      const cards = await queryEntity<{
        readonly id: string,
        readonly pagedCards: Envelope<{ readonly title: string }>,
      }>(database.sql, definitions, 'Deck', {
        fields: ['id', 'pagedCards.title'],
        where: { id: deckA },
      })
      expect(cards[0]?.pagedCards.$total).toBe(2)
      expect(cards[0]?.pagedCards.items.map(item => item.title)).toEqual(['Card One'])

      const cardOverride = await queryEntity<{
        readonly id: string,
        readonly pagedCards: Envelope<{ readonly title: string }>,
      }>(database.sql, definitions, 'Deck', {
        fields: ['id', 'pagedCards{$orderBy:title}', 'pagedCards.title'],
        where: { id: deckA },
      })
      expect(cardOverride[0]?.pagedCards.$total).toBe(2)
      expect(cardOverride[0]?.pagedCards.items.map(item => item.title)).toEqual(['Card Two'])

      expect(() => compileEntityQuery(definitions, 'Deck', {
        fields: ['id', 'pagedEntries{$orderBy:missing}'],
      })).toThrow('Unknown collection record field')
    })
  })

  test('composes authored and query values in one member query', async () => {
    await withLifecycleDatabase('explicit-collections', async database => {
      await seed(database)
      const rows = await queryEntity<{
        readonly id: string,
        readonly largeEntries: Envelope<RecordItem>,
      }>(database.sql, definitions, 'Deck', {
        fields: ['id', 'largeEntries[quantity > 2]'],
        where: { id: deckA },
      })
      expect(rows[0]?.largeEntries.$matched).toBe(1)
      expect(rows[0]?.largeEntries.$total).toBe(1)
      expect(rows[0]?.largeEntries.items.map(item => item.quantity)).toEqual([5])
    })
  })
})
