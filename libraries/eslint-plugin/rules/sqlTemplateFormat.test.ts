import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { sqlTemplateFormat } from './sqlTemplateFormat'

/**
 * Lint and fix one JavaScript fixture.
 * @param code - Fixture source.
 * @returns Lint and fix result.
 */
function lint(code: string) {
  return new Linter().verifyAndFix(code, [{
    languageOptions: { parserOptions: { ecmaVersion: 'latest' } },
    plugins: { test: { rules: { 'sql-template-format': sqlTemplateFormat } } },
    rules: { 'test/sql-template-format': 'error' },
  }], { filename: 'fixture.js' })
}

describe('sqlTemplateFormat', () => {
  test('formats clauses, uppercase keywords, and indentation', () => {
    const output = lint('db.sql`SELECT * FROM "Entity" WHERE "id" = 1;`')
    expect(output.fixed).toBe(true)
    expect(output.output).toBe('db.sql`\n  SELECT *\n  FROM "Entity"\n  WHERE "id" = 1\n`')
  })

  test('preserves quoted text and interpolations', () => {
    const output = lint('sql`SELECT "Value" FROM "T" WHERE "title" = ${title}`')
    expect(output.fixed).toBe(true)
    expect(output.output).toContain('"Value"')
    expect(output.output).toContain('${title}')
  })

  test('does not auto-format comment-bearing SQL', () => {
    for (const code of [
      'sql`select 1 -- where false`',
      'sql`select 1 /* where false */`',
    ]) {
      const output = lint(code)
      expect(output.fixed).toBe(false)
      expect(output.output).toBe(code)
    }
  })

  test('does not auto-format dollar-quoted bodies', () => {
    const code = 'sql`select $$a\n  b$$`'
    const output = lint(code)
    expect(output.fixed).toBe(false)
    expect(output.output).toBe(code)
  })

  test('does not reformat interpolated expressions while wrapping SQL', () => {
    const expression = "sql.array(tag.aliasesForThisParticularlyLongFieldName, 'TEXT')"
    const code = [
      'const query = sql`select',
      `\${${expression}},`,
      '${tag.anotherExtremelyLongFieldNameForTesting},',
      '${tag.thirdLongFieldNameForTesting}`',
    ].join(' ')
    const output = lint(code)
    expect(output.fixed).toBe(true)
    expect(output.output).toContain(`\${${expression}}`)
  })

  test('preserves expression commas when formatting a multiline template', () => {
    const code = [
      'const query = sql`(',
      '  ${tag.id}::text,',
      "  ${sql.array(tag.aliases, 'TEXT')}::text[],",
      '  ${tag.classifierEligible}::boolean',
      ')`',
    ].join('\n')
    const output = lint(code)
    expect(output.fixed).toBe(true)
    expect(output.output).toContain("${sql.array(tag.aliases, 'TEXT')}")
    expect(lint(output.output).messages.filter(message => message.fatal)).toEqual([])
  })

  test('accepts canonical multiline SQL', () => {
    const code = 'sql`\n  SELECT 1\n`'
    expect(lint(code).fixed).toBe(false)
  })
})
