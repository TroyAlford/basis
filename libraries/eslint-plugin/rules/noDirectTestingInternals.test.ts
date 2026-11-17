import { describe, expect, test } from 'bun:test'
import { lintRule } from './complianceTestUtils'
import { noDirectTestingInternals } from './noDirectTestingInternals'

const lint = (code: string, filename = 'fixture.test.ts') => lintRule(noDirectTestingInternals, code, filename)

const expectsReport = (code: string): void => {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noDirectTestingInternals')
  expect(messages[0]?.message).toContain('basis/testing')
}

describe('noDirectTestingInternals', () => {
  test('reports a deep basis/testing import', () => {
    expectsReport('import { tempDirectory } from \'basis/testing/tempDirectory\'')
  })

  test('reports a public-helper implementation import', () => {
    expectsReport('import { matchScreenshot } from \'basis/testing/matchScreenshot\'')
  })

  test('reports a side-effect deep import', () => {
    expectsReport('import \'basis/testing/tempDirectory\'')
  })

  test('reports a deep export', () => {
    expectsReport('export { tempDirectory } from \'basis/testing/tempDirectory\'')
  })

  test('reports an export-all', () => {
    expectsReport('export * from \'basis/testing/tempDirectory\'')
  })

  test('reports a dynamic import', () => {
    expectsReport('await import(\'basis/testing/tempDirectory\')')
  })

  test('reports a require', () => {
    expectsReport('const { tempDirectory } = require(\'basis/testing/tempDirectory\')')
  })

  test('reports a type-only deep import', () => {
    expectsReport('import type { Temp } from \'basis/testing/tempDirectory\'')
  })

  test('reports the private @basis/testing workspace', () => {
    expectsReport('import { tempDirectory } from \'@basis/testing\'')
  })

  test('reports a private @basis/testing subpath', () => {
    expectsReport('import { tempDirectory } from \'@basis/testing/tempDirectory\'')
  })

  test('reports a basis/libraries testing path', () => {
    expectsReport('import { tempDirectory } from \'basis/libraries/testing/temp\'')
  })

  test('reports a relative libraries/testing path', () => {
    expectsReport('import { tempDirectory } from \'../libraries/testing/temp\'')
  })

  test('allows the public basis/testing entrypoint', () => {
    expect(lint('import { tempDirectory } from \'basis/testing\'')).toHaveLength(0)
  })

  test('allows the public preload entrypoint', () => {
    expect(lint('import \'basis/testing/bun\'')).toHaveLength(0)
  })

  test('allows an unrelated testing path', () => {
    expect(lint('import { helper } from \'./testing/helper\'')).toHaveLength(0)
  })

  test('allows internal implementation files to import each other', () => {
    expect(lint('import { tempDirectory } from \'./temp\'', 'libraries/testing/suite.test.ts')).toHaveLength(0)
  })
})
