import { describe, expect, test } from 'bun:test'
import { resolveCollectionRelation } from './CollectionRelation'
import { collectionSqlRelation } from './CollectionSql'
import { compileEntityQuery } from './Database'
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
          field: 'largeEntries',
          target: 'DeckCardPrinting',
          type: 'Collection',
          via: 'DeckCardPrinting[deck = @ $and quantity > 3]',
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
        {
          field: 'memberCards',
          target: 'Card',
          type: 'Collection',
          via: 'DeckMember[deck = @].card',
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
    fields: [{ field: 'label', type: 'String' }],
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
      'largeEntries',
      'cards',
      'printings',
      'memberCards',
    ]))
    expect(names).toHaveLength(7)
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
      definition: expect.objectContaining({ name: 'DeckCardPrinting' }),
      kind: 'record',
      relationship: expect.objectContaining({ name: 'DeckCardPrinting' }),
    })
    expect(entries.predicates.filters).toEqual([])
  })

  test('resolves a projected entity collection with its authored predicates', () => {
    const cards = relation('cards')
    expect(cards.resultType).toBe('entity')
    expect(cards.identity).toEqual({ kind: 'entity' })
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
    })
    expect(inverse.owner).toEqual({ column: 'deck.id' })
    expect(inverse.identity).toEqual({ kind: 'entity' })
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
    expect(derived.identity).toEqual({ kind: 'entity' })
    expect(derived.predicates.filters).toEqual([])
  })

  test('lowers a relationship-derived relation through the shared SQL adapter', () => {
    const sql = collectionSqlRelation(definitions, relation('memberRecords'), '"deck"."id"', {
      relationship: 'edge',
      root: 'root',
      target: 'card',
    })
    expect(sql).toEqual({
      condition: '"edge"."deck.id" = "deck"."id"',
      ownerId: '"edge"."deck.id"',
      relation: '"DeckMember" "edge" JOIN "Card" "card" ' +
        'ON "card"."id" = "edge"."card.id" JOIN "Entity" "root" ON "root"."id" = "card"."id"',
      relationshipAlias: 'edge',
      resultType: 'entity',
      rootAlias: 'root',
      targetAlias: 'card',
    })
  })

  test('lowers an entity-projected collection with authored predicates', () => {
    const sql = collectionSqlRelation(definitions, relation('cards'), '"deck"."id"', {
      relationship: 'edge',
      root: 'root',
      target: 'card',
    })
    expect(sql).toEqual({
      condition: '"edge"."deck.id" = "deck"."id"',
      ownerId: '"edge"."deck.id"',
      predicate: { sql: 'COALESCE("edge"."quantity" > $1, FALSE)', values: [3] },
      relation: '"DeckCardPrinting" "edge" JOIN "Card" "card" ' +
        'ON "card"."id" = "edge"."card.id" JOIN "Entity" "root" ON "root"."id" = "card"."id"',
      relationshipAlias: 'edge',
      resultType: 'entity',
      rootAlias: 'root',
      targetAlias: 'card',
    })
  })

  test('lowers a record collection with composite identity and authored predicates', () => {
    const sql = collectionSqlRelation(definitions, relation('largeEntries'), '"deck"."id"', {
      relationship: 'edge',
      root: 'root',
      target: 'target',
    })
    expect(sql).toEqual({
      condition: '"edge"."deck.id" = "deck"."id"',
      ownerId: '"edge"."deck.id"',
      predicate: { sql: 'COALESCE("edge"."quantity" > $1, FALSE)', values: [3] },
      relation: '"DeckCardPrinting" "edge"',
      relationshipAlias: 'edge',
      resultType: 'record',
    })
  })

  test('lowers a record collection without an entity root', () => {
    const sql = collectionSqlRelation(definitions, relation('entries'), '"deck"."id"', {
      relationship: 'edge',
      root: 'root',
      target: 'target',
    })
    expect(sql).toEqual({
      condition: '"edge"."deck.id" = "deck"."id"',
      ownerId: '"edge"."deck.id"',
      relation: '"DeckCardPrinting" "edge"',
      relationshipAlias: 'edge',
      resultType: 'record',
    })
  })

  test('projects unambiguous relationship properties on an Entity collection', () => {
    const compiled = compileEntityQuery(definitions, 'Deck', {
      fields: ['id', 'memberCards.label'],
    })
    expect(compiled.sql).toContain('json_build_object')
    expect(compiled.sql).toContain('"label"')
  })

  test('rejects ambiguous relationship-owned projection on an Entity collection', () => {
    expect(() => compileEntityQuery(definitions, 'Deck', {
      fields: ['id', 'cards.deckCardPrinting.quantity'],
    })).toThrow('cannot project relationship-owned field')
  })

  test('binds authored via predicates only where they are emitted', () => {
    const compiled = compileEntityQuery(definitions, 'Deck', {
      fields: ['id'],
      where: 'largeEntries $contains (quantity < 10)',
    })
    const placeholders = new Set(
      [...compiled.sql.matchAll(/\$(\d+)/gu)].map(match => Number(match[1])),
    )
    expect(placeholders.size).toBe(compiled.values.length)
    expect(compiled.values.filter(value => value === 3)).toHaveLength(1)
    expect(compiled.values.filter(value => value === 10)).toHaveLength(1)
  })

  test('rejects adversarial ordering identifiers', () => {
    expect(() => compileEntityQuery(definitions, 'Deck', {
      fields: ['id', 'entries{$orderBy:quantity; DROP TABLE "Deck"; --}'],
    })).toThrow()
    expect(() => compileEntityQuery(definitions, 'Deck', {
      fields: ['id'],
      orderBy: 'id; DROP TABLE "Deck"; --',
    })).toThrow()
  })
})
