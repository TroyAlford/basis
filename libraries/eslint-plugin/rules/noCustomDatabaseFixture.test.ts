import { describe, expect, test } from 'bun:test'
import { lintRule } from './complianceTestUtils'
import { noCustomDatabaseFixture } from './noCustomDatabaseFixture'

const lint = (code: string) => lintRule(noCustomDatabaseFixture, code, 'fixture.test.ts')

const expectsReport = (code: string): void => {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noCustomDatabaseFixture')
  expect(messages[0]?.message).toContain('useDatabaseFixture')
}

describe('noCustomDatabaseFixture', () => {
  test('reports a pg Pool', () => {
    expectsReport('import { Pool } from \'pg\'\nnew Pool()')
  })

  test('reports an aliased pg Client', () => {
    expectsReport('import { Client as DbClient } from \'pg\'\nnew DbClient()')
  })

  test('reports a namespace pg client', () => {
    expectsReport('import * as pg from \'pg\'\nnew pg.Pool()')
  })

  test('reports a destructured pg require', () => {
    expectsReport('const { Pool } = require(\'pg\')\nnew Pool()')
  })

  test('reports a postgres client', () => {
    expectsReport('import postgres from \'postgres\'\npostgres(\'postgres://localhost\')')
  })

  test('reports a Bun SQL client', () => {
    expectsReport('import { SQL } from \'bun\'\nnew SQL(\'postgres://localhost\')')
  })

  test('reports a testcontainers PostgreSQL container', () => {
    expectsReport('import { PostgreSqlContainer } from \'@testcontainers/postgresql\'\nnew PostgreSqlContainer()')
  })

  test('reports a generic testcontainers container', () => {
    expectsReport('import { GenericContainer } from \'testcontainers\'\nnew GenericContainer(\'postgres\')')
  })

  test('reports a docker postgres launcher', () => {
    expectsReport('import { run } from \'basis/utilities\'\nrun(\'docker\', [\'run\', \'postgres:17\'])')
  })

  test('reports a podman postgres launcher', () => {
    expectsReport('import { runAsync } from \'basis/utilities\'\nrunAsync(\'podman\', [\'run\', \'postgres\'])')
  })

  test('allows the Basis database fixture', () => {
    expect(lint([
      'import { useDatabaseFixture } from \'basis/testing\'',
      'await useDatabaseFixture(\'test\')',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows the internal Basis lifecycle helper', () => {
    expect(lint([
      'import { withLifecycleDatabase } from \'../testing/DatabaseLifecycle\'',
      'await withLifecycleDatabase(\'test\', () => undefined)',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows a type-only pg import', () => {
    expect(lint('import type { Pool } from \'pg\'\nconst pool: Pool | null = null')).toHaveLength(0)
  })

  test('allows an unrelated Pool', () => {
    expect(lint('class Pool {}\nnew Pool()')).toHaveLength(0)
  })
})
