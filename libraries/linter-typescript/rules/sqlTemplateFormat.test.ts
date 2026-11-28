/* eslint-disable @stylistic/max-len -- SQL fixtures need long lines. */
import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { formatSQL, sqlTemplateFormat } from './sqlTemplateFormat'

/** Lint and fix one JavaScript fixture. */
function lint(code: string) {
  return new Linter().verifyAndFix(code, [{
    languageOptions: { parserOptions: { ecmaVersion: 'latest' } },
    plugins: { test: { rules: { 'sql-template-format': sqlTemplateFormat } } },
    rules: { 'test/sql-template-format': 'error' },
  }], { filename: 'fixture.js' })
}

/** Extract the template body from fixed source. */
function body(output: string): string {
  return output.slice(output.indexOf('`') + 1, output.lastIndexOf('`'))
}

describe('formatSQL', () => {
  test('formats through dprint', () => {
    expect(formatSQL('select id, name from widgets where active = true')).toBe(
      'SELECT id, name\nFROM widgets\nWHERE active = TRUE\n',
    )
  })

  test('formats multiple statements with blank lines', () => {
    expect(formatSQL('select 1; select 2')).toBe('SELECT 1;\n\nSELECT 2\n')
  })
})

describe('sqlTemplateFormat', () => {
  test('formats a tagged template', () => {
    const output = lint('db.sql`select * from "Entity" where "id" = 1;`')
    expect(output.fixed).toBe(true)
    expect(body(output.output)).toMatchIndented(`
      SELECT *
      FROM "Entity"
      WHERE "id" = 1;
    `)
  })

  test('preserves one interpolation', () => {
    const output = lint('sql`select * from "Entity" where "id" = ${id}`')
    expect(output.fixed).toBe(true)
    expect(output.output).toContain('${id}')
  })

  test('preserves multiple interpolations and their exact source', () => {
    const output = lint('sql`select ${a}, ${fn(`nested ${value}`, /},/.test(value))}, ${  spaced  } from t`')
    expect(output.fixed).toBe(true)
    expect(output.output).toContain('${a}')
    expect(output.output).toContain('${fn(`nested ${value}`, /},/.test(value))}')
    expect(output.output).toContain('${  spaced  }')
  })

  test('avoids placeholder collisions', () => {
    const output = lint('sql`select __basis_param_0__, ${value} from t`')
    expect(output.fixed).toBe(true)
    expect(output.output).toContain('__basis_param_0__')
    expect(output.output).toContain('${value}')
  })

  test('is idempotent', () => {
    const once = lint('sql`select * from "Entity" where "id" = ${id}`')
    expect(once.fixed).toBe(true)
    expect(lint(once.output).fixed).toBe(false)
  })

  test('formats comments', () => {
    const output = lint('sql`select id, -- stable identifier\n name from widgets\n-- active only\nwhere active = true`')
    expect(output.fixed).toBe(true)
    expect(body(output.output)).toContain('-- stable identifier')
    expect(body(output.output)).toContain('-- active only')
  })

  test('formats PL/pgSQL bodies', () => {
    const output = lint('sql`create or replace function f() returns trigger as $$ begin if new.x is null then new.x = 1; end if; return new; end $$ language plpgsql`')
    expect(output.fixed).toBe(true)
    expect(body(output.output)).toContain('BEGIN')
    expect(body(output.output)).toContain('IF new.x IS NULL THEN')
    expect(body(output.output)).toContain('RETURN new;')
  })
})
