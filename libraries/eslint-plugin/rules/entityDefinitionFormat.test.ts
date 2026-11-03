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
    const code = '{"entities":[{"name":"User","fields":[{"name":"id","type":"uuid"}]}]}'
    expect(lint(code).fixed).toBe(false)
  })
})
