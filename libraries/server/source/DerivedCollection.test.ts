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
