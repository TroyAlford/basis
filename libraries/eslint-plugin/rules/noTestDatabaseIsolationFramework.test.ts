import { describe, expect, test } from 'bun:test'
import { lintRule } from './complianceTestUtils'
import { noTestDatabaseIsolationFramework } from './noTestDatabaseIsolationFramework'

const lint = (code: string) => lintRule(noTestDatabaseIsolationFramework, code, 'fixture.test.ts')

const expectsReport = (code: string): void => {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noTestDatabaseIsolationFramework')
  expect(messages[0]?.message).toContain('Basis database fixture')
}

describe('noTestDatabaseIsolationFramework', () => {
  test('reports a custom schema', () => {
    expectsReport('const sql = Bun.sql\nawait sql`CREATE SCHEMA test_schema`')
  })

  test('reports a custom database', () => {
    expectsReport('await sql.unsafe(\'CREATE DATABASE test_database\')')
  })

  test('reports dropping a schema', () => {
    expectsReport('await sql`DROP SCHEMA test_schema CASCADE`')
  })

  test('reports a search path override', () => {
    expectsReport('await sql`SET search_path TO test_schema`')
  })

  test('reports a namespace SQL member', () => {
    expectsReport('await db.sql.unsafe(\'create schema test_schema\')')
  })

  test('reports a createdb process', () => {
    expectsReport('import { run } from \'basis/utilities\'\nrun(\'createdb\', [\'test_database\'])')
  })

  test('reports a dropdb process', () => {
    expectsReport('import { runAsync } from \'basis/utilities\'\nrunAsync(\'dropdb\', [\'test_database\'])')
  })

  test('reports psql schema creation', () => {
    expectsReport('Bun.spawn([\'psql\', \'-c\', \'CREATE SCHEMA test_schema\'])')
  })

  test('reports pg-mem', () => {
    expectsReport('import { newDb } from \'pg-mem\'\nnewDb()')
  })

  test('reports PGlite', () => {
    expectsReport('import { PGlite } from \'@electric-sql/pglite\'\nnew PGlite()')
  })

  test('reports sql.js', () => {
    expectsReport('import initSqlJs from \'sql.js\'\nawait initSqlJs()')
  })

  test('reports better-sqlite3', () => {
    expectsReport('import Database from \'better-sqlite3\'\nnew Database(\':memory:\')')
  })

  test('allows the internal Basis fixture and lifecycle helpers', () => {
    expect(lint([
      'import { useDatabaseFixture } from \'../testing/DatabaseFixture\'',
      'import { withLifecycleDatabase } from \'../testing/DatabaseLifecycle\'',
      'await useDatabaseFixture(\'test\')',
      'await withLifecycleDatabase(\'test\', () => undefined)',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows ordinary table work in the fixture', () => {
    expect(lint('await sql`SELECT * FROM note`')).toHaveLength(0)
  })

  test('allows a test command that mentions a schema', () => {
    expect(lint([
      'import { run } from \'basis/utilities\'',
      'run(\'bun\', [\'test\', \'schema.test.ts\'])',
    ].join('\n'))).toHaveLength(0)
  })
})
