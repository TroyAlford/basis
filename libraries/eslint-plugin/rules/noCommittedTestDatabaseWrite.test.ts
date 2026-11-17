import { describe, expect, test } from 'bun:test'
import { lintRule } from './complianceTestUtils'
import { noCommittedTestDatabaseWrite } from './noCommittedTestDatabaseWrite'

const lint = (code: string) => lintRule(noCommittedTestDatabaseWrite, code, 'fixture.test.ts')

const expectsReport = (code: string): void => {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noCommittedTestDatabaseWrite')
  expect(messages[0]?.message).toContain('withDatabase')
}

describe('noCommittedTestDatabaseWrite', () => {
  test('reports withDurableDatabase', () => {
    expectsReport([
      'import { withDurableDatabase } from \'basis/testing\'',
      'await withDurableDatabase(\'test\', () => undefined)',
    ].join('\n'))
  })

  test('reports an aliased withDurableDatabase', () => {
    expectsReport([
      'import { withDurableDatabase as commit } from \'basis/testing\'',
      'await commit(\'test\', () => undefined)',
    ].join('\n'))
  })

  test('reports withCommittedDatabase', () => {
    expectsReport([
      'import { withCommittedDatabase } from \'../testing/DatabaseFixture\'',
      'await withCommittedDatabase(\'test\', null, () => undefined)',
    ].join('\n'))
  })

  test('reports a namespace member', () => {
    expectsReport([
      'import * as database from \'../testing/DatabaseIsolation\'',
      'await database.withDurableDatabase(\'test\', () => undefined)',
    ].join('\n'))
  })

  test('reports a destructured require', () => {
    expectsReport([
      'const { withCommittedDatabase } = require(\'../testing/DatabaseFixture\')',
      'await withCommittedDatabase(\'test\', null, () => undefined)',
    ].join('\n'))
  })

  test('allows withDatabase', () => {
    expect(lint([
      'import { withDatabase } from \'basis/testing\'',
      'await withDatabase(\'test\', null, database => database.query(\'Note\', { fields: [\'id\'] }))',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows the internal rollback lifecycle helper', () => {
    expect(lint([
      'import { withLifecycleDatabase } from \'../testing/DatabaseLifecycle\'',
      'await withLifecycleDatabase(\'test\', () => undefined)',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows an unrelated local function', () => {
    expect(lint('const withDurableDatabase = () => undefined\nwithDurableDatabase()')).toHaveLength(0)
  })
})
