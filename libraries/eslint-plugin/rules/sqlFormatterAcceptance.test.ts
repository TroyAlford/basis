import { beforeAll, describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { loadModule, parsePlPgSQLSync } from 'libpg-query'
import type { CorpusReport } from './sqlCorpus'
import { plSemantics, scanProductionCorpus } from './sqlCorpus'
import { sqlCoverage } from './sqlCoverage'
import { formatSQL, formatSQLResult, sqlTemplateFormat } from './sqlTemplateFormat'

/**
 * Lint and fix one SQL template fixture.
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

let report: CorpusReport

beforeAll(async () => {
  await loadModule()
  report = await scanProductionCorpus()
})

describe('SQL formatter acceptance contract', () => {
  test('1. every discovered production statement formats successfully', () => {
    expect(report.candidates).toBeGreaterThan(0)
    expect(report.nodes.size).toBeGreaterThan(0)
    expect(report.unsupported).toEqual([])
    expect(report.parseFailures).toEqual([])
    expect(report.invalidFormatted).toEqual([])
  })

  test('2. every dynamic production SQL call site has fixture coverage', () => {
    expect(report.unresolved).toEqual([])
    expect(report.runtimeSites).toHaveLength(5)
    expect(report.runtimeFixtures).toBeGreaterThan(0)
  })

  test('3. every SQL statement preserves normalized parse-tree equivalence', () => {
    expect(report.semanticFailures).toEqual([])
  })

  test('4. PL/pgSQL bodies preserve normalized equivalence, including expressions', () => {
    expect(report.plSemanticFailures).toEqual([])
    const functionSql = (value: number): string => `
      create function f() returns integer as $$
      begin
        return ${value};
      end $$ language plpgsql
    `
    const one = plSemantics(parsePlPgSQLSync(functionSql(1)))
    const two = plSemantics(parsePlPgSQLSync(functionSql(2)))
    expect(one).not.toEqual(two)
  })

  test('5. formatting every corpus statement is idempotent', () => {
    expect(report.idempotenceFailures).toEqual([])
    const once = formatSQL('select id, name from widgets where active = true and owner_id = $1')
    expect(formatSQL(once)).toBe(once)
  })

  test('6. unsupported top-level, nested, and PL/pgSQL constructs are non-fixable', () => {
    const cases = [
      { construct: 'DefineStmt', sql: 'create operator ^ (leftarg = int, rightarg = int, procedure = int4eq)' },
      { construct: 'JsonIsPredicate', sql: 'select * from t where data is json' },
      {
        construct: 'PLpgSQL_stmt_open',
        sql: 'create function f() returns void as $$ ' +
          'declare c refcursor; begin open c for select 1; end $$ language plpgsql',
      },
    ]
    for (const { construct, sql } of cases) {
      const code = `sql\`${sql}\``
      const output = lint(code)
      const diagnostic = output.messages.find(message => message.messageId === 'unsupportedSql')
      expect(diagnostic?.message).toContain(construct)
      expect(diagnostic?.fix).toBeUndefined()
      expect(output.output).toBe(code)
    }
  })

  test('7. parser and formatter failures are non-fixable and preserve source', () => {
    const sql = 'select from'
    const result = formatSQLResult(sql)
    expect(result.status).toBe('parse-error')
    expect(result.formatted).toBe(sql)
    const code = `sql\`${sql}\``
    const output = lint(code)
    const diagnostic = output.messages.find(message => message.messageId === 'parseErrorSql')
    expect(diagnostic?.message).toContain('syntax error')
    expect(diagnostic?.fix).toBeUndefined()
    expect(output.output).toBe(code)
  })

  test('8. an unsupported production-corpus addition fails coverage', async () => {
    const regressed = await scanProductionCorpus([{
      file: 'coverage-regression.sql',
      source: 'fixture',
      sql: 'create operator ^ (leftarg = int, rightarg = int, procedure = int4eq)',
    }])
    expect(regressed.unsupported.some(issue => issue.construct === 'DefineStmt')).toBe(true)
    expect(sqlCoverage(regressed).corpusPercent).toBe(0)
  })

  test('9. canonical formatting keeps quoting, aliases, operator grouping, and breaks', () => {
    expect(formatSQL(`
      select widgetId as displayName from widgetTable where active = true and owner_id = $1
    `)).toBe([
      'SELECT "widgetId" AS "displayName"',
      'FROM "widgetTable"',
      'WHERE "active" = true',
      '  AND "owner_id" = $1',
    ].join('\n'))
  })
})
