import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { createComplianceConfig } from './compliance'

const lint = (code: string, filename: string) => new Linter().verify(code, createComplianceConfig(), filename)

const messageIds = (code: string, filename: string): string[] => (
  lint(code, filename)
    .map(message => message.messageId)
    .filter((id): id is string => id !== null)
    .sort()
)

describe('createComplianceConfig', () => {
  test('runs the architecture policy in application source', () => {
    const code = [
      'import { useState } from \'react\'',
      'export const Hello = () => {',
      '  const [value] = useState(0)',
      '  return <p>{value}</p>',
      '}',
    ].join('\n')
    expect(messageIds(code, 'src/Hello.tsx')).toContain('reactHook')
  })

  test('does not run the architecture policy in test source', () => {
    const code = [
      'import { useState } from \'react\'',
      'export const Hello = () => {',
      '  const [value] = useState(0)',
      '  return <p>{value}</p>',
      '}',
    ].join('\n')
    expect(messageIds(code, 'src/Hello.test.tsx')).not.toContain('reactHook')
  })

  test('runs process and testing-internals rules everywhere', () => {
    const code = [
      'import { tempDirectory } from \'basis/testing/tempDirectory\'',
      'Bun.spawn([\'bun\', \'test\'])',
      'tempDirectory(\'fixture\')',
    ].join('\n')
    expect(messageIds(code, 'src/app.ts')).toEqual(['noDirectProcessSpawn', 'noDirectTestingInternals'])
  })

  test('runs test-infrastructure rules in test source', () => {
    const code = [
      'import { chromium } from \'playwright\'',
      'await chromium.launch()',
      'await page.screenshot()',
    ].join('\n')
    expect(messageIds(code, 'src/example.test.ts')).toEqual([
      'noAlternativeScreenshots',
      'noDirectBrowserLifecycle',
    ])
  })

  test('does not run test-infrastructure rules in application source', () => {
    const code = [
      'import { chromium } from \'playwright\'',
      'await chromium.launch()',
      'await page.screenshot()',
    ].join('\n')
    expect(messageIds(code, 'src/example.ts')).toEqual([])
  })

  test('reports both process and server rules for a manual server launcher', () => {
    const code = 'Bun.spawn([\'bun\', \'./server.ts\'])'
    expect(messageIds(code, 'test/server.test.ts')).toEqual([
      'noCustomTestServer',
      'noDirectProcessSpawn',
    ])
  })

  test('reports only the fixture rule when the allowed runner launches a server', () => {
    const code = [
      'import { runAsync } from \'basis/utilities\'',
      'await runAsync(\'bun\', [\'run\', \'start\'])',
    ].join('\n')
    expect(messageIds(code, 'test/server.test.ts')).toEqual(['noCustomTestServer'])
  })

  test('does not apply style rules', () => {
    expect(messageIds('export const value = "quoted"\n', 'src/value.ts')).toEqual([])
  })
})
