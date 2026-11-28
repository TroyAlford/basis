import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { transactionSqlName } from './transactionSqlName'

/**
 * Lint and fix one JavaScript fixture.
 * @param code - Fixture source.
 * @returns Lint and fix result.
 */
function lint(code: string) {
  return new Linter().verifyAndFix(code, [{
    languageOptions: { parserOptions: { ecmaVersion: 'latest' } },
    plugins: { test: { rules: { 'transaction-sql-name': transactionSqlName } } },
    rules: { 'test/transaction-sql-name': 'error' },
  }], { filename: 'fixture.js' })
}

describe('transactionSqlName', () => {
  test('renames a database transaction binding and its references', () => {
    const output = lint('db.tx(async transaction => { await transaction`select 1` })')
    expect(output.fixed).toBe(true)
    expect(output.output).toBe('db.tx(async sql => { await sql`select 1` })')
  })

  test('accepts the canonical binding', () => {
    const code = 'db.tx(async sql => { await sql`select 1` })'
    expect(lint(code).fixed).toBe(false)
  })

  test('adds async to a transaction arrow with the canonical binding', () => {
    const output = lint('database.tx(sql => sql`select 1`)')
    expect(output.fixed).toBe(true)
    expect(output.output).toBe('database.tx(async sql => sql`select 1`)')
  })

  test('does not rewrite unrelated tx methods', () => {
    const code = 'builder.tx(async transaction => transaction())'
    expect(lint(code).fixed).toBe(false)
  })

  test('reports without fixing ambiguous bindings', () => {
    const output = lint('db.tx(async transaction => { const sql = 1; transaction`select 1` })')
    expect(output.fixed).toBe(false)
  })
})
