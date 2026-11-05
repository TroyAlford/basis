import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import * as jsoncParser from 'jsonc-eslint-parser'
import { entityDefinitionFormat } from './entityDefinitionFormat'

/**
 * Lint and fix one entity JSON fixture.
 * @param code - Fixture source.
 * @returns Lint and fix result.
 */
function lint(code: string) {
  return new Linter().verifyAndFix(code, [{
    files: ['**/*.entities.json'],
    languageOptions: { parser: jsoncParser },
    plugins: { test: { rules: { 'entity-definition-format': entityDefinitionFormat } } },
    rules: { 'test/entity-definition-format': 'error' },
  }], { filename: 'fixture.entities.json' })
}

describe('entityDefinitionFormat', () => {
  test('orders entity and field properties canonically', () => {
    const code = JSON.stringify({ entities: [{ fields: [{ field: 'email', type: 'String' }], name: 'User' }] })
    const canonical = `${JSON.stringify(JSON.parse(
      '{"entities":[{"name":"User","fields":[{"field":"email","type":"String"}]}]}',
    ), null, 2)}\n`
    const output = lint(canonical)
    expect(output.fixed).toBe(false)
    expect(lint(code).fixed).toBe(true)
    expect(lint(code).output).toContain('"name": "User"')
    expect(lint(code).output).toContain('"field": "email"')
  })

  test('accepts canonical documents', () => {
    const code = `${JSON.stringify(JSON.parse(
      '{"entities":[{"name":"User","fields":[{"field":"id","format":"UUID"}]}]}',
    ), null, 2)}\n`
    expect(lint(code).fixed).toBe(false)
  })

  test('orders native arrays and named relationships canonically', () => {
    const code = JSON.stringify({
      entities: [{
        fields: [
          {
            field: 'tags',
            fields: undefined,
            items: { type: 'String' },
            type: 'Array',
          },
          {
            field: 'author',
            inverse: 'articles',
            target: 'User',
            type: 'Entity',
          },
        ],
        name: 'Article',
      }, {
        fields: [{
          cardinality: 'Many',
          field: 'articles',
          inverse: 'author',
          target: 'Article',
          type: 'Inverse',
        }],
        name: 'User',
      }, {
        fields: [],
        name: 'Campaign',
      }],
      relationships: [{
        between: [
          { field: 'user', inverse: 'campaigns', target: 'User' },
          { field: 'campaign', inverse: 'members', target: 'Campaign' },
        ],
        fields: [
          { field: 'role', type: 'String' },
        ],
        name: 'Membership',
      }],
    })
    const output = lint(code)
    expect(output.fixed).toBe(true)
    expect(output.output).toContain('"field": "tags"')
    expect(output.output).toContain('"type": "Array"')
    expect(output.output).toContain('"field": "author"')
    expect(output.output).toContain('"inverse": "articles"')
    expect(output.output).toContain('"cardinality": "Many"')
    expect(output.output.indexOf('"inverse": "author"')).toBeLessThan(
      output.output.indexOf('"cardinality": "Many"'),
    )
    expect(output.output).toContain('"relationships": [')
    expect(output.output).toContain('"between": [')
    expect(output.output).toContain('"field": "user"')
    expect(output.output).toContain('"inverse": "campaigns"')
    expect(output.output).toContain('"field": "role"')
    expect(output.output.indexOf('"entities"')).toBeLessThan(output.output.indexOf('"relationships"'))
  })

  test('delegates semantics to the canonical loader before fixing', () => {
    const cases = [
      '{"entities":[{"name":"User","fields":[]},{"name":"User","fields":[]}]}',
      '{"entities":[{"name":"User","fields":[]}],"extra":"keep"}',
      '{"entities":[{"name":"Child","extends":"Missing","fields":[]}]}',
    ]
    for (const code of cases) {
      const output = lint(code)
      expect(output.fixed).toBe(false)
      expect(output.output).toBe(code)
    }
  })

  test('rejects invalid scalar format and ID declarations without fixing', () => {
    const cases = [
      '{"entities":[{"name":"User","fields":[{"field":"email","type":"String","format":"UUID"}]}]}',
      '{"entities":[{"name":"User","fields":[{"field":"other","type":"ID"}]}]}',
      '{"entities":[{"name":"User","fields":[{"field":"name","type":"String"}]}]}',
    ]
    for (const code of cases) {
      const output = lint(code)
      expect(output.fixed).toBe(false)
    }
  })

  test('reports obsolete vocabulary without fixing', () => {
    for (const code of [
      '{"entities":[{"name":"User","fields":[{"name":"id","type":"uuid"}]}]}',
      '{"entities":[{"name":"User","fields":[{"field":"events",' +
        '"type":"ValueCollection","items":{"type":"Structured"}}]}]}',
      '{"entities":[{"name":"User","fields":[{"field":"owner","column":"ownerId","target":"User","type":"Entity"}]}]}',
    ]) {
      expect(lint(code).fixed).toBe(false)
    }
  })
})
