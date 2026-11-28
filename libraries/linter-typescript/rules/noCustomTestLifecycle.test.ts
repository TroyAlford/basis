import { describe, expect, test } from 'bun:test'
import { lintRule } from './complianceTestUtils'

const lint = (code: string) => lintRule('noCustomTestLifecycle', code, 'fixture.test.ts')

const expectsReport = (code: string): void => {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noCustomTestLifecycle')
  expect(messages[0]?.message).toContain('basis/testing/bun')
}

describe('noCustomTestLifecycle', () => {
  test('reports startApplication', () => {
    expectsReport('import { startApplication } from \'basis/testing\'\nawait startApplication()')
  })

  test('reports an aliased startApplication', () => {
    expectsReport('import { startApplication as start } from \'basis/testing\'\nawait start()')
  })

  test('reports stopApplications', () => {
    expectsReport('import { stopApplications } from \'basis/testing\'\nawait stopApplications()')
  })

  test('reports registerRunCleanup', () => {
    expectsReport('import { registerRunCleanup } from \'basis/testing\'\nregisterRunCleanup(() => undefined)')
  })

  test('reports manual process exit cleanup', () => {
    expectsReport('process.on(\'exit\', () => undefined)')
  })

  test('reports manual SIGINT cleanup', () => {
    expectsReport('process.on(\'SIGINT\', () => undefined)')
  })

  test('reports manual SIGTERM cleanup', () => {
    expectsReport('process.once(\'SIGTERM\', () => undefined)')
  })

  test('reports Bun signal cleanup', () => {
    expectsReport('Bun.addSignalListener(\'SIGINT\', () => undefined)')
  })

  test('reports lifecycle orchestration inside a hook', () => {
    expectsReport([
      'import { startApplication } from \'basis/testing\'',
      'beforeAll(async () => { await startApplication() })',
    ].join('\n'))
  })

  test('allows the Basis application fixture', () => {
    expect(lint([
      'import { useApplication } from \'basis/testing\'',
      'await useApplication(() => undefined)',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows the Basis database fixture', () => {
    expect(lint([
      'import { useDatabaseFixture } from \'basis/testing\'',
      'await useDatabaseFixture(\'test\')',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows unrelated hooks', () => {
    expect(lint('afterEach(() => localStorage.clear())')).toHaveLength(0)
  })

  test('allows unrelated process listeners', () => {
    expect(lint('process.on(\'uncaughtException\', () => undefined)')).toHaveLength(0)
  })
})
