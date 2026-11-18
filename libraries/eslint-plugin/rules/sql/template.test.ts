/* eslint-disable @stylistic/max-len -- SQL fixtures and protocol field names need long lines. */
import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { sqlTemplateFormat } from '../sqlTemplateFormat'

/**
 * Lint and fix one JavaScript fixture.
 * @param code
 */
function lint(code: string) {
  return new Linter().verifyAndFix(code, [{
    languageOptions: { parserOptions: { ecmaVersion: 'latest' } },
    plugins: { test: { rules: { 'sql-template-format': sqlTemplateFormat } } },
    rules: { 'test/sql-template-format': 'error' },
  }], { filename: 'fixture.js' })
}

/**
 * Extract the template body from fixed source.
 * @param output
 */
function body(output: string): string {
  return output.slice(output.indexOf('`') + 1, output.lastIndexOf('`'))
}

describe('template interpolation', () => {
  test('preserves one interpolation and formats around it', () => {
    const output = lint('sql`select * from "Entity" where "id" = ${id}`')
    expect(output.fixed).toBe(true)
    expect(body(output.output)).toMatchIndented(`
      SELECT *
      FROM "Entity"
      WHERE "id" = \${id}
    `)
  })

  test('preserves multiple interpolations', () => {
    const output = lint('sql`select ${a}, ${b} from t where id = ${c}`')
    expect(output.fixed).toBe(true)
    expect(output.output).toContain('${a}')
    expect(output.output).toContain('${b}')
    expect(output.output).toContain('${c}')
  })

  test('preserves interpolations adjacent to identifiers and operators', () => {
    const output = lint('sql`select ${column}::text, ${left}||${right} from t where ${predicate}`')
    expect(output.fixed).toBe(true)
    expect(output.output).toContain('${column}::TEXT')
    expect(output.output).toContain('${left} || ${right}')
    expect(output.output).toContain('${predicate}')
  })

  test('preserves multiline interpolation source exactly', () => {
    const expression = 'fn(\n  value,\n  other,\n)'
    const output = lint(`sql\`select \${${expression}}, \${tail}\``)
    expect(output.fixed).toBe(true)
    expect(output.output).toContain(`\${${expression}}`)
  })

  test('preserves nested templates, strings, and regex literals', () => {
    const expression = 'fn(`nested ${value}`, /},/.test(value))'
    const output = lint(`sql\`select \${${expression}} from t\``)
    expect(output.fixed).toBe(true)
    expect(output.output).toContain(`\${${expression}}`)
  })

  test('avoids placeholder collisions with source identifiers', () => {
    const output = lint('sql`select __basis_param_0__, ${value} from t`')
    expect(output.fixed).toBe(true)
    expect(output.output).toContain('__basis_param_0__')
    expect(output.output).toContain('${value}')
  })

  test('does not autofix a template that cannot be parsed with placeholders', () => {
    const code = 'sql`${query}`'
    const output = lint(code)
    expect(output.output).toBe(code)
    expect(output.messages.length).toBeGreaterThan(0)
    expect(output.messages[0]?.fix).toBeUndefined()
  })

  test('does not autofix malformed SQL', () => {
    const code = 'sql`select from ${value}`'
    const output = lint(code)
    expect(output.output).toBe(code)
    expect(output.messages.length).toBeGreaterThan(0)
    expect(output.messages[0]?.fix).toBeUndefined()
  })

  test('does not autofix unsupported SQL', () => {
    const code = 'sql`select * from t where ${value} is json`'
    const output = lint(code)
    expect(output.output).toBe(code)
    expect(output.messages.length).toBeGreaterThan(0)
    expect(output.messages[0]?.fix).toBeUndefined()
  })

  test('is idempotent after a fix', () => {
    const once = lint('sql`select * from "Entity" where "id" = ${id}`')
    expect(once.fixed).toBe(true)
    expect(lint(once.output).fixed).toBe(false)
  })
})
