import { Logger } from 'basis/logger'
import { tempDirectory } from 'basis/testing'
import { run } from 'basis/utilities'
import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const COMPLIANCE = join(import.meta.dir, 'compliance.ts')
const silent = new Logger({ silent: true })

/**
 * Run the real compliance config through Bun's built-in linter.
 * @param code - Fixture source.
 * @param filename - Fixture path.
 * @returns The combined linter report.
 */
const lint = (code: string, filename: string): string => {
  const root = tempDirectory(`compliance-${randomUUID()}`)
  const fixture = join(root, filename)
  mkdirSync(dirname(fixture), { recursive: true })
  writeFileSync(fixture, code)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, type: 'module' }))
  const config = join(root, 'eslint.config.mjs')
  const configSource = [
    `import { createComplianceConfig } from '${COMPLIANCE}'`,
    'export default createComplianceConfig()',
    '',
  ].join('\n')
  writeFileSync(config, configSource)
  const result = run(process.execPath, ['lint', '--config', config, fixture], {
    cwd: root,
    logger: silent,
  })
  return `${result.stdout.toString()}${result.stderr.toString()}`
}

const COMPONENT_MESSAGES: [string, string][] = [
  ['customHook', 'Custom React hook'],
  ['functionComponent', 'is used as a function component'],
  ['reactClassBase', 'extends React'],
  ['reactFunctionType', 'not allowed as a component type'],
  ['reactHook', 'React hook'],
  ['reactWrapper', 'creates a function component'],
]

/**
 * Extract the rule message ids from a lint report.
 * @param report - Bun linter output.
 * @returns Sorted, unique message ids.
 */
const messageIds = (report: string): string[] => {
  const ids = new Set<string>()
  for (const line of report.split('\n')) {
    const match = /^\s*\d+:\d+\s+error\s+(.*?)\s+(@basis\/[\w-]+)\s*$/.exec(line)
    if (match === null) continue
    if (match[2] === '@basis/component-architecture') {
      const mapped = COMPONENT_MESSAGES.find(([, text]) => match[1].includes(text))?.[0]
      if (mapped !== undefined) ids.add(mapped)
    } else {
      const name = match[2].slice('@basis/'.length).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
      ids.add(name)
    }
  }
  return [...ids].sort()
}

const messagesFor = (code: string, filename: string): string[] => messageIds(lint(code, filename))

describe('createComplianceConfig', () => {
  test('runs the architecture policy in application source', () => {
    const code = [
      'import { useState } from \'react\'',
      'export const Hello = () => {',
      '  const [value] = useState(0)',
      '  return <p>{value}</p>',
      '}',
    ].join('\n')
    expect(messagesFor(code, 'src/Hello.tsx')).toContain('reactHook')
  })

  test('does not run the architecture policy in test source', () => {
    const code = [
      'import { useState } from \'react\'',
      'export const Hello = () => {',
      '  const [value] = useState(0)',
      '  return <p>{value}</p>',
      '}',
    ].join('\n')
    expect(messagesFor(code, 'src/Hello.test.tsx')).not.toContain('reactHook')
  })

  test('runs process and testing-internals rules everywhere', () => {
    const code = [
      'import { tempDirectory } from \'basis/testing/tempDirectory\'',
      'Bun.spawn([\'bun\', \'test\'])',
      'tempDirectory(\'fixture\')',
    ].join('\n')
    expect(messagesFor(code, 'src/app.ts')).toEqual(['noDirectProcessSpawn', 'noDirectTestingInternals'])
  })

  test('runs test-infrastructure rules in test source', () => {
    const code = [
      'import { chromium } from \'playwright\'',
      'await chromium.launch()',
      'await page.screenshot()',
    ].join('\n')
    expect(messagesFor(code, 'src/example.test.ts')).toEqual([
      'noAlternativeScreenshots',
      'noDirectBrowserLifecycle',
    ])
  })

  test('does not run test-infrastructure rules in application source', () => {
    const code = [
      'import { chromium } from \'playwright\'',
      'await chromium.launch()',
      'await page.screenshot()',
      'await page.goto(\'/workspace\')',
    ].join('\n')
    expect(messagesFor(code, 'src/example.ts')).toEqual([])
  })

  test('requires application visits for navigation in test source', () => {
    const code = 'await page.goto(\'/workspace\')'
    expect(messagesFor(code, 'src/example.e2e.ts')).toEqual(['noDirectApplicationNavigation'])
  })

  test('allows application visits in test source', () => {
    const code = [
      'import { useApplication } from \'basis/testing\'',
      'const app = await useApplication({ entry: \'./serve.ts\' })',
      'await app.visit(\'/workspace\', async page => page.click(\'button\'))',
    ].join('\n')
    expect(messagesFor(code, 'src/example.e2e.ts')).toEqual([])
  })

  test('requires auto-rollback database tests', () => {
    const code = [
      'import { withDurableDatabase } from \'basis/testing\'',
      'await withDurableDatabase(\'test\', () => undefined)',
    ].join('\n')
    expect(messagesFor(code, 'src/example.test.ts')).toEqual(['noCommittedTestDatabaseWrite'])
  })

  test('allows withDatabase', () => {
    const code = [
      'import { withDatabase } from \'basis/testing\'',
      'await withDatabase(\'test\', null, database => database.query(\'Note\', { fields: [\'id\'] }))',
    ].join('\n')
    expect(messagesFor(code, 'src/example.test.ts')).toEqual([])
  })

  test('reports both process and server rules for a manual server launcher', () => {
    const code = 'Bun.spawn([\'bun\', \'./server.ts\'])'
    expect(messagesFor(code, 'test/server.test.ts')).toEqual([
      'noCustomTestServer',
      'noDirectProcessSpawn',
    ])
  })

  test('reports only the fixture rule when the allowed runner launches a server', () => {
    const code = [
      'import { runAsync } from \'basis/utilities\'',
      'await runAsync(\'bun\', [\'run\', \'start\'])',
    ].join('\n')
    expect(messagesFor(code, 'test/server.test.ts')).toEqual(['noCustomTestServer'])
  })

  test('does not apply style rules', () => {
    expect(messagesFor('export const value = "quoted"\n', 'src/value.ts')).toEqual([])
  })
})
