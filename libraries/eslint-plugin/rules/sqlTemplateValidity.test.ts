/* eslint-disable @stylistic/max-len -- SQL fixtures need long lines. */
import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { sqlTemplateValidity } from './sqlTemplateValidity'

/** Lint one JavaScript fixture without applying fixes. */
function lint(code: string) {
  return new Linter().verify(code, [{
    languageOptions: { parserOptions: { ecmaVersion: 'latest' } },
    plugins: { test: { rules: { 'sql-template-valid': sqlTemplateValidity } } },
    rules: { 'test/sql-template-valid': 'warn' },
  }], { filename: 'fixture.js' })
}

describe('sqlTemplateValidity', () => {
  test('reports malformed SQL', () => {
    const messages = lint('sql`select from`')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.message).toContain('SQL template is invalid')
    expect(messages[0]?.fix).toBeUndefined()
  })

  test('accepts valid PostgreSQL', () => {
    expect(lint('sql`select id from widgets where active = true`')).toEqual([])
  })

  test('accepts PL/pgSQL function bodies', () => {
    expect(lint('sql`create function f() returns trigger as $$ begin return new; end $$ language plpgsql`')).toEqual([])
  })
})
