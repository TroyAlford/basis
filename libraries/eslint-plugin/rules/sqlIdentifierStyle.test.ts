/* eslint-disable @stylistic/max-len -- SQL fixtures need long lines. */
import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { sqlIdentifierStyle } from './sqlIdentifierStyle'

/** Lint one JavaScript fixture without applying fixes. */
function lint(code: string) {
  return new Linter().verify(code, [{
    languageOptions: { parserOptions: { ecmaVersion: 'latest' } },
    plugins: { test: { rules: { 'sql-identifier-style': sqlIdentifierStyle } } },
    rules: { 'test/sql-identifier-style': 'warn' },
  }], { filename: 'fixture.js' })
}

describe('sqlIdentifierStyle', () => {
  test('reports unquoted camelCase and PascalCase identifiers', () => {
    const messages = lint('sql`select userId, DisplayName from user_accounts`')
    expect(messages.map(message => message.message)).toEqual([
      expect.stringContaining('"userId"'),
      expect.stringContaining('"DisplayName"'),
    ])
  })

  test('accepts snake_case and quoted identifiers', () => {
    expect(lint('sql`select user_id, "userId", id from user_accounts`')).toEqual([])
  })

  test('reports mixed-case aliases and tables', () => {
    const messages = lint('sql`select UserGroup.id from (select id from users) UserGroup`')
    expect(messages.some(message => message.message.includes('"UserGroup"'))).toBe(true)
  })
})
