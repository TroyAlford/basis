import { describe, expect, test } from 'bun:test'
import { resolveCollectionRelation } from './CollectionRelation'
import { collectionSqlRelation } from './CollectionSql'
import { EntityDefinitions } from './EntityDefinitions'
import { Operator } from './Operator'

const definitions = EntityDefinitions.load(JSON.stringify({
  entities: [
    {
      fields: [
        { field: 'id', format: 'UUID' },
        {
          cardinality: 'Many',
          field: 'cardsByDeck',
          inverse: 'deck',
          target: 'Card',
          type: 'Inverse',
        },
        {
          field: 'entries',
          target: 'DeckCardPrinting',
          type: 'Collection',
          via: 'DeckCardPrinting[deck = @]',
        },
        {
          field: 'cards',
          target: 'Card',
          type: 'Collection',
          via: 'DeckCardPrinting[deck = @ $and quantity > 3].card',
        },
        {
          field: 'printings',
          target: 'Printing',
          type: 'Collection',
          via: 'entries.printing',
        },
      ],
      name: 'Deck',
    },
    {
      fields: [
        { field: 'id', format: 'UUID' },
        { field: 'deck', inverse: 'cardsByDeck', target: 'Deck', type: 'Entity' },
      ],
      name: 'Card',
    },
    { fields: [{ field: 'id', format: 'UUID' }], name: 'Printing' },
  ],
  relationships: [{
    between: [
      { field: 'deck', target: 'Deck' },
      { field: 'card', target: 'Card' },
      { field: 'printing', target: 'Printing' },
    ],
    fields: [{ field: 'quantity', type: 'Number' }],
    name: 'DeckCardPrinting',
  }, {
    between: [
      { field: 'deck', inverse: 'memberRecords', target: 'Deck' },
      { field: 'card', target: 'Card' },
    ],
    fields: [],
    name: 'DeckMember',
  }],
}))

const deck = definitions.entity('Deck')
if (!deck) throw new Error('missing Deck entity')

/**
 * Resolve one Deck collection into its canonical relation.
 * @param name - Collection navigation name.
 * @returns The resolved relation.
 */
function relation(name: string) {
  const collection = deck?.collections.find(candidate => candidate.name === name)
  if (!collection) throw new Error(`missing collection "${name}"`)
  return resolveCollectionRelation(collection, value => definitions.entity(value))
}

describe('CollectionRelation', () => {
  test('derives relationship navigations only for named inverse endpoints', () => {
    const names = deck.collections.map(collection => collection.name)
    expect(names).toEqual(expect.arrayContaining([
      'cardsByDeck',
      'memberRecords',
      'entries',
      'cards',
      'printings',
    ]))
    expect(names).toHaveLength(5)
  })

  test('resolves a relationship-record collection to composite identity', () => {
    const entries = relation('entries')
    expect(entries.resultType).toBe('record')
    expect(entries.identity).toEqual({
      columns: ['deck.id', 'card.id', 'printing.id'],
      kind: 'record',
    })
    expect(entries.owner).toEqual({
      column: 'deck.id',
      endpoint: expect.objectContaining({ field: 'deck', target: 'Deck' }),
    })
    expect(entries.source).toEqual({
      kind: 'relationship',
      relationship: expect.objectContaining({ name: 'DeckCardPrinting' }),
    })
    expect(entries.target).toEqual({
      kind: 'record',
      relationship: expect.objectContaining({ name: 'DeckCardPrinting' }),
    })
    expect(entries.predicates.filters).toEqual([])
  })

  test('resolves a projected entity collection with its authored predicates', () => {
    const cards = relation('cards')
    expect(cards.resultType).toBe('entity')
    expect(cards.identity).toEqual({ column: 'id', kind: 'entity' })
    expect(cards.owner).toEqual({
      column: 'deck.id',
      endpoint: expect.objectContaining({ field: 'deck', target: 'Deck' }),
    })
    expect(cards.source).toEqual({
      kind: 'relationship',
      relationship: expect.objectContaining({ name: 'DeckCardPrinting' }),
      remote: expect.objectContaining({ field: 'card', target: 'Card' }),
    })
    expect(cards.target).toEqual({
      definition: expect.objectContaining({ name: 'Card' }),
      kind: 'entity',
    })
    expect(cards.predicates.filters).toEqual([
      { field: 'quantity', operator: Operator.Comparison.GreaterThan, value: 3 },
    ])
  })

  test('resolves an inherited via projection through the canonical path parser', () => {
    const printings = relation('printings')
    expect(printings.resultType).toBe('entity')
    expect(printings.owner).toEqual({
      column: 'deck.id',
      endpoint: expect.objectContaining({ field: 'deck', target: 'Deck' }),
    })
    expect(printings.source).toEqual({
      kind: 'relationship',
      relationship: expect.objectContaining({ name: 'DeckCardPrinting' }),
      remote: expect.objectContaining({ field: 'printing', target: 'Printing' }),
    })
    expect(printings.target).toEqual({
      definition: expect.objectContaining({ name: 'Printing' }),
      kind: 'entity',
    })
    expect(printings.predicates.filters).toEqual([])
  })

  test('normalizes inverse and relationship-derived source adapters', () => {
    const inverse = relation('cardsByDeck')
    expect(inverse.source).toEqual({
      kind: 'inverse',
      reference: expect.objectContaining({ name: 'deck' }),
      table: 'Card',
    })
    expect(inverse.owner).toEqual({ column: 'deck.id' })
    expect(inverse.identity).toEqual({ column: 'id', kind: 'entity' })
    expect(inverse.target).toEqual({
      definition: expect.objectContaining({ name: 'Card' }),
      kind: 'entity',
    })

    const derived = relation('memberRecords')
    expect(derived.source).toEqual({
      kind: 'relationship',
      relationship: expect.objectContaining({ name: 'DeckMember' }),
      remote: expect.objectContaining({ field: 'card', target: 'Card' }),
    })
    expect(derived.owner).toEqual({
      column: 'deck.id',
      endpoint: expect.objectContaining({ field: 'deck', target: 'Deck' }),
    })
    expect(derived.identity).toEqual({ column: 'id', kind: 'entity' })
    expect(derived.predicates.filters).toEqual([])
  })

  test('lowers a relationship-derived relation through the shared SQL adapter', () => {
    const sql = collectionSqlRelation(relation('memberRecords'), '"deck"."id"', {
      relationship: 'edge',
      root: 'root',
      target: 'card',
    })
    expect(sql).toEqual({
      condition: '"edge"."deck.id" = "deck"."id"',
      relation: '"DeckMember" "edge" JOIN "Card" "card" ' +
        'ON "card"."id" = "edge"."card.id" JOIN "Entity" "root" ON "root"."id" = "card"."id"',
      relationshipAlias: 'edge',
      rootAlias: 'root',
      targetAlias: 'card',
    })
  })

  test('keeps explicit collections out of SQL lowering until projection lands', () => {
    expect(() => collectionSqlRelation(relation('cards'), '"deck"."id"', {
      relationship: 'edge',
      root: 'root',
      target: 'card',
    })).toThrow('Explicit Collections')
  })
})
