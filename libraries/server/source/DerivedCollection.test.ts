import { describe, expect, test } from 'bun:test'
import { compileEntityQuery } from './Database'
import { EntityDefinitions } from './EntityDefinitions'

/**
 * Build the shared derived-collection contract fixture.
 * @returns Canonical definitions for the contract.
 */
function definitions(): EntityDefinitions {
  return EntityDefinitions.load(JSON.stringify({
    entities: [
      {
        fields: [
          {
            field: 'entries',
            target: 'DeckCardPrinting',
            type: 'Collection',
            via: 'DeckCardPrinting[deck = @]{$limit:2,$offset:1}',
          },
          {
            field: 'cards',
            target: 'Card',
            type: 'Collection',
            via: 'DeckCardPrinting[deck = @]{$limit:2,$offset:1}.card',
          },
          {
            field: 'sortedCards',
            target: 'Card',
            type: 'Collection',
            via: 'DeckCardPrinting[deck = @]{$orderBy:-name}.card',
          },
          {
            field: 'aliasedCards',
            target: 'Card',
            type: 'Collection',
            via: 'entries.card',
          },
        ],
        name: 'Deck',
      },
      { fields: [], name: 'Card' },
      { fields: [], name: 'Printing' },
    ],
    relationships: [{
      between: [
        { field: 'deck', target: 'Deck' },
        { field: 'card', target: 'Card' },
        { field: 'printing', target: 'Printing' },
      ],
      fields: [{ field: 'quantity', type: 'Number' }],
      name: 'DeckCardPrinting',
    }],
  }))
}

describe('Derived Collection contract', () => {
  const entities = definitions()

  const compile = (field: string) => compileEntityQuery(entities, 'Deck', {
    fields: ['id', field],
  })

  const equivalent = (actual: string, expected: string): void => {
    const left = compile(actual)
    const right = compile(expected)
    expect(left.sql).toBe(right.sql)
    expect(left.values).toEqual(right.values)
  }

  test('Entity projections honor authored limit and offset', () => {
    equivalent('cards', 'cards{$limit:2,$offset:1}')
  })

  test('Entity projections honor authored ordering', () => {
    equivalent('sortedCards', 'sortedCards{$orderBy:-name}')
  })

  test('aliases inherit collection pagination defaults', () => {
    equivalent('aliasedCards', 'aliasedCards{$limit:2,$offset:1}')
  })

  test('query-time directives override authored defaults', () => {
    equivalent('cards{$limit:4,$offset:0}', 'cards{$offset:0,$limit:4}')
    expect(compile('cards{$limit:4,$offset:0}').sql).not.toBe(compile('cards').sql)
    expect(compile('sortedCards').sql).toContain('"__item"."name" DESC')
    expect(compile('sortedCards{$orderBy:name}').sql).toContain('"__item"."name" ASC')
  })

  test('rejects relationship-only ordering on a projected Entity', () => {
    const invalid = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [{
            field: 'cards',
            target: 'Card',
            type: 'Collection',
            via: 'DeckCardPrinting[deck = @]{$orderBy:card}.card',
          }],
          name: 'Deck',
        },
        { fields: [], name: 'Card' },
        { fields: [], name: 'Printing' },
      ],
      relationships: [{
        between: [
          { field: 'deck', target: 'Deck' },
          { field: 'card', target: 'Card' },
          { field: 'printing', target: 'Printing' },
        ],
        fields: [],
        name: 'DeckCardPrinting',
      }],
    }))
    expect(() => compileEntityQuery(invalid, 'Deck', { fields: ['cards'] }))
      .toThrow(/ambiguous/)
  })

  test('rejects relationship properties on projected Entity items', () => {
    expect(() => compile('cards.quantity')).toThrow(/record collection|relationship property/i)
  })

  test('keeps authored via values parameterized through projection and counts', () => {
    const parameterized = EntityDefinitions.load(JSON.stringify({
      entities: [
        {
          fields: [{
            field: 'filtered',
            target: 'DeckCardPrinting',
            type: 'Collection',
            via: 'DeckCardPrinting[deck = @ $and label = "O\'Brien" ' +
              "$and occurredOn = '2026-01-02' " +
              "$and recordedAt = '2026-01-02T03:04:05Z' " +
              "$and card = '00000000-0000-4000-8000-000000000902']",
          }],
          name: 'Deck',
        },
        { fields: [], name: 'Card' },
        { fields: [], name: 'Printing' },
      ],
      relationships: [{
        between: [
          { field: 'deck', target: 'Deck' },
          { field: 'card', target: 'Card' },
          { field: 'printing', target: 'Printing' },
        ],
        fields: [
          { field: 'label', type: 'String' },
          { field: 'occurredOn', type: 'Date' },
          { field: 'recordedAt', type: 'Timestamp' },
        ],
        name: 'DeckCardPrinting',
      }],
    }))
    const projected = compileEntityQuery(parameterized, 'Deck', {
      fields: ['id', 'filtered'],
    })
    expect(projected.sql).not.toContain("O'Brien")
    expect(projected.sql).toContain('$1')
    expect(projected.values).toEqual(expect.arrayContaining([
      "O'Brien",
      '2026-01-02',
      '2026-01-02T03:04:05Z',
      '00000000-0000-4000-8000-000000000902',
    ]))
    const counted = compileEntityQuery(parameterized, 'Deck', {
      fields: ['id'],
      where: 'filtered.$total = 1',
    })
    expect(counted.sql).not.toContain("O'Brien")
    expect(counted.sql).toContain('$1')
    expect(counted.values).toEqual(expect.arrayContaining([
      "O'Brien",
      '2026-01-02',
      '2026-01-02T03:04:05Z',
      '00000000-0000-4000-8000-000000000902',
    ]))
    const combined = compileEntityQuery(parameterized, 'Deck', {
      fields: ['id', 'filtered[label = "query\'value"]'],
    })
    expect(combined.sql).not.toContain("O'Brien")
    expect(combined.sql).not.toContain("query'value")
    expect(combined.values).toEqual(expect.arrayContaining(["O'Brien", "query'value"]))
  })

  test('relationship records retain composite identity', () => {
    const records = compile('entries')
    expect(records.sql).toContain('"DeckCardPrinting"')
    expect(records.sql).toContain('LIMIT 2')
    expect(records.sql).toContain('OFFSET 1')
    expect(entities.ddl.join('\n')).toContain('primary key ("deck.id", "card.id", "printing.id")')
  })

  test('derived fields do not create physical columns', () => {
    const ddl = entities.ddl.join('\n')
    expect(ddl).not.toMatch(/"cards"\s+text/i)
    expect(ddl).not.toMatch(/"entries"\s+text/i)
    expect(ddl).not.toMatch(/"aliasedCards"\s+text/i)
  })
})
