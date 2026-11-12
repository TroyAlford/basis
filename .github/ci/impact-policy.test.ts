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
 * Analyze one changed path against Basis's lane policy.
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
  test('ordinary database files select only the database lane', () => {
    for (const path of [
      'libraries/server/source/Database.e2e.ts',
      'libraries/server/source/DatabaseSeed.e2e.ts',
      'libraries/server/source/Schema.e2e.ts',
      'libraries/server/source/QueryPlanning.e2e.ts',
    ]) {
      const result = decision(path)
      expect(result.suites.database.needed).toBe(true)
      expect(result.suites.e2e.needed).toBe(false)
      expect(result.suites.lifecycle.needed).toBe(false)
    }
  }, 30_000)

  test('destructive recovery files select the recovery lane', () => {
    for (const path of [
      'libraries/server/source/Authorization.e2e.ts',
      'libraries/server/source/PostgresOperations.e2e.ts',
      'libraries/server/source/Release.e2e.ts',
      'libraries/testing/application.lifecycle.test.ts',
    ]) {
      const result = decision(path)
      expect(result.suites.recovery.needed).toBe(true)
      expect(result.suites.lifecycle.needed).toBe(false)
      expect(result.suites.database.needed).toBe(false)
      expect(result.suites.e2e.needed).toBe(false)
    }
  }, 30_000)

  test('fast fixture and recovery proofs select the lifecycle lane', () => {
    for (const path of [
      'libraries/server/source/DatabaseFixture.lifecycle.e2e.ts',
      'libraries/server/source/ReleaseRecovery.e2e.ts',
      'libraries/testing/runtime.lifecycle.e2e.ts',
    ]) {
      const result = decision(path)
      expect(result.suites.lifecycle.needed).toBe(true)
      expect(result.suites.recovery.needed).toBe(false)
    }
  }, 30_000)

  test('unit and screenshot files select the unit lane', () => {
    for (const path of [
      'libraries/server/source/Graph.test.ts',
      'libraries/react/components/Button/Button.test.tsx',
      'libraries/react/components/Button/Button.screenshot.tsx',
    ]) {
      const result = decision(path)
      expect(result.suites.unit.needed).toBe(true)
    }
  }, 30_000)

  test('browser journeys select the e2e lane', () => {
    const result = decision('libraries/react/components/Table/Table.e2e.ts')
    expect(result.suites.e2e.needed).toBe(true)
    expect(result.suites.database.needed).toBe(false)
    expect(result.suites.lifecycle.needed).toBe(false)
  })

  test('docs changes select docs without running a test lane', () => {
    const result = decision('docs/server/query-language.mdx')
    expect(result.suites.docs.needed).toBe(true)
    expect(result.suites.database.needed).toBe(false)
    expect(result.suites.e2e.needed).toBe(false)
    expect(result.suites.lifecycle.needed).toBe(false)
  })

  test('toolchain changes fail closed across every test lane', () => {
    const result = decision('.github/workflows/ci.yml')
    for (const suite of ['unit', 'database', 'e2e', 'lifecycle', 'recovery']) {
      expect(result.suites[suite].needed).toBe(true)
    }
  })

  test('unknown changes fail closed across every test lane', () => {
    const result = decision('mystery.bin')
    for (const suite of ['unit', 'database', 'e2e', 'lifecycle', 'recovery']) {
      expect(result.suites[suite].needed).toBe(true)
    }
  })
})
