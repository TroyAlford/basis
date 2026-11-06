import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChangedFile, ImpactConfig } from '../actions/change-impact/main'
import { analyze } from '../actions/change-impact/main'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const configText = readFileSync(join(root, '.github/ci-impact.json'), 'utf8')
const config = JSON.parse(configText) as ImpactConfig

/**
 * Analyze one changed path against Basis's intended lane policy.
 * @param path - Repository-relative changed path.
 * @returns The impact decision.
 */
function decision(path: string) {
  const changedFiles: ChangedFile[] = [{ path, status: 'M' }]
  return analyze({
    changedFiles,
    config,
    configText,
    cwd: root,
    headSha: 'head',
    mergeBase: 'base',
  })
}

describe('Basis change-impact policy', () => {
  test('database fixture implementation selects fixture lanes, not pure unit', () => {
    const result = decision('libraries/server/testing/DatabaseFixture.ts')
    expect(result.suites['database-fixtures'].needed).toBe(true)
    expect(result.suites['fixture-lifecycle'].needed).toBe(true)
  })

  test('query execution changes select PostgreSQL behavior', () => {
    const result = decision('libraries/server/source/PolymorphicQuery.ts')
    expect(result.suites.e2e.needed).toBe(true)
  })

  test('React component changes select component and screenshot coverage', () => {
    const result = decision('libraries/react/components/Button/Button.tsx')
    expect(result.suites.component.needed).toBe(true)
    expect(result.suites.screenshots.needed).toBe(true)
  })

  test('docs changes select docs and visual coverage', () => {
    const result = decision('docs/server/query-language.mdx')
    expect(result.suites.docs.needed).toBe(true)
    expect(result.suites.visual.needed).toBe(true)
  })

  test('HMR harness changes select lifecycle and HMR proofs', () => {
    const result = decision('libraries/testing/application.ts')
    expect(result.suites.lifecycle.needed).toBe(true)
    expect(result.suites.hmr.needed).toBe(true)
  })

  test('toolchain changes fail closed across every code suite', () => {
    const result = decision('.github/workflows/ci.yml')
    for (const suite of [
      'unit',
      'component',
      'contract',
      'server',
      'lifecycle',
      'screenshots',
      'e2e',
      'visual',
      'database-fixtures',
      'fixture-lifecycle',
      'hmr',
    ]) {
      expect(result.suites[suite].needed).toBe(true)
    }
  })

  test('unknown changes fail closed', () => {
    const result = decision('mystery.bin')
    expect(result.suites.unit.needed).toBe(true)
    expect(result.suites.e2e.needed).toBe(true)
    expect(result.suites['fixture-lifecycle'].needed).toBe(true)
  })
})
