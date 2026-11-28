import { describe, expect, test } from 'bun:test'
import { lintRule } from './complianceTestUtils'

const lint = (code: string, filename = 'fixture.ts') => lintRule('noDirectProcessSpawn', code, filename)

const expectsReport = (code: string): void => {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noDirectProcessSpawn')
  expect(messages[0]?.message).toContain('basis/utilities')
}

describe('noDirectProcessSpawn', () => {
  test('reports Bun.spawn', () => {
    expectsReport('Bun.spawn([\'bun\', \'test\'])')
  })

  test('reports Bun.spawnSync', () => {
    expectsReport('Bun.spawnSync([\'bun\', \'test\'])')
  })

  test('reports a Bun shell template', () => {
    expectsReport('Bun.$`bun test`')
  })

  test('reports a named child_process import', () => {
    expectsReport('import { spawn } from \'node:child_process\'\nspawn(\'bun\', [\'test\'])')
  })

  test('reports an aliased child_process import', () => {
    expectsReport('import { spawn as launch } from \'node:child_process\'\nlaunch(\'bun\', [\'test\'])')
  })

  test('reports a namespace child_process import', () => {
    expectsReport('import * as cp from \'node:child_process\'\ncp.execSync(\'bun test\')')
  })

  test('reports a default child_process import', () => {
    expectsReport('import cp from \'node:child_process\'\ncp.spawn(\'bun\', [\'test\'])')
  })

  test('reports a destructured require', () => {
    expectsReport('const { exec } = require(\'node:child_process\')\nexec(\'bun test\')')
  })

  test('reports an aliased destructured require', () => {
    expectsReport('const { execFile: launch } = require(\'child_process\')\nlaunch(\'bun\')')
  })

  test('reports a static require member', () => {
    expectsReport('require(\'node:child_process\').spawn(\'bun\', [\'test\'])')
  })

  test('reports a variable alias', () => {
    expectsReport('const launch = Bun.spawn\nlaunch([\'bun\', \'test\'])')
  })

  test('reports a namespace alias', () => {
    expectsReport([
      'import * as cp from \'node:child_process\'',
      'const child = cp',
      'child.fork(\'worker.ts\')',
    ].join('\n'))
  })

  test('reports destructuring from a namespace alias', () => {
    expectsReport([
      'import * as cp from \'node:child_process\'',
      'const { spawnSync } = cp',
      'spawnSync(\'bun\', [\'test\'])',
    ].join('\n'))
  })

  test('reports destructuring from Bun', () => {
    expectsReport('const { spawn } = Bun\nspawn([\'bun\', \'test\'])')
  })

  test('reports a wrapper package import', () => {
    expectsReport('import { execa } from \'execa\'\nexeca(\'bun\', [\'test\'])')
  })

  test('allows the Basis run helpers', () => {
    expect(lint([
      'import { run, runAsync } from \'basis/utilities\'',
      'run(\'bun\', [\'test\'])',
      'await runAsync(\'bun\', [\'test\'])',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows an unrelated local spawn function', () => {
    expect(lint('const spawn = (command: string) => command\nspawn(\'bun\')')).toHaveLength(0)
  })

  test('allows member access that is not called', () => {
    expect(lint('const api = Bun')).toHaveLength(0)
  })
})
