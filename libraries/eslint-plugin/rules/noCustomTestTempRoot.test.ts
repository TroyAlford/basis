import { describe, expect, test } from 'bun:test'
import { lintRule } from './complianceTestUtils'
import { noCustomTestTempRoot } from './noCustomTestTempRoot'

const lint = (code: string) => lintRule(noCustomTestTempRoot, code, 'fixture.test.ts')

const expectsReport = (code: string): void => {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noCustomTestTempRoot')
  expect(messages[0]?.message).toContain('tempDirectory')
}

describe('noCustomTestTempRoot', () => {
  test('reports mkdtempSync', () => {
    expectsReport('import { mkdtempSync } from \'node:fs\'\nmkdtempSync(\'/tmp/test-\')')
  })

  test('reports an aliased mkdtempSync', () => {
    expectsReport('import { mkdtempSync as makeTemp } from \'fs\'\nmakeTemp(\'/tmp/test-\')')
  })

  test('reports a namespace fs.mkdtemp', () => {
    expectsReport('import * as fs from \'node:fs\'\nawait fs.promises.mkdtemp(\'/tmp/test-\')')
  })

  test('reports fs/promises mkdtemp', () => {
    expectsReport('import { mkdtemp } from \'node:fs/promises\'\nawait mkdtemp(\'/tmp/test-\')')
  })

  test('reports a destructured require', () => {
    expectsReport('const { mkdtempSync } = require(\'node:fs\')\nmkdtempSync(\'/tmp/test-\')')
  })

  test('reports a static require member', () => {
    expectsReport('require(\'node:fs\').mkdtempSync(\'/tmp/test-\')')
  })

  test('reports tmpdir', () => {
    expectsReport('import { tmpdir } from \'node:os\'\ntmpdir()')
  })

  test('reports an aliased tmpdir', () => {
    expectsReport('import { tmpdir as tempRoot } from \'os\'\ntempRoot()')
  })

  test('reports os.tmpdir', () => {
    expectsReport('import * as os from \'node:os\'\nos.tmpdir()')
  })

  test('reports a TMPDIR override', () => {
    expectsReport('process.env.TMPDIR = \'/tmp/basis\'')
  })

  test('reports a TMP override', () => {
    expectsReport('process.env.TMP = \'/tmp/basis\'')
  })

  test('allows the Basis tempDirectory', () => {
    expect(lint([
      'import { tempDirectory } from \'basis/testing\'',
      'const root = tempDirectory(\'test\')',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows ordinary directory creation', () => {
    expect(lint('import { mkdirSync } from \'node:fs\'\nmkdirSync(\'./fixtures\')')).toHaveLength(0)
  })

  test('allows reading an environment variable', () => {
    expect(lint('const value = process.env.TMPDIR')).toHaveLength(0)
  })
})
