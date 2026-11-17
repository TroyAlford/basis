import { describe, expect, test } from 'bun:test'
import { lintRule } from './complianceTestUtils'
import { noDirectApplicationNavigation } from './noDirectApplicationNavigation'

const lint = (code: string) => lintRule(noDirectApplicationNavigation, code, 'fixture.e2e.ts')

const expectsReport = (code: string): void => {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noDirectApplicationNavigation')
  expect(messages[0]?.message).toContain('app.visit')
}

describe('noDirectApplicationNavigation', () => {
  test('reports page.goto', () => {
    expectsReport('await page.goto(\'/workspace\')')
  })

  test('reports page.reload', () => {
    expectsReport('await page.reload()')
  })

  test('reports page.goBack', () => {
    expectsReport('await page.goBack()')
  })

  test('reports page.goForward', () => {
    expectsReport('await page.goForward()')
  })

  test('reports a computed navigation method', () => {
    expectsReport('await page[\'goto\'](\'/workspace\')')
  })

  test('reports an aliased page', () => {
    expectsReport('const current = page\nawait current.goto(\'/workspace\')')
  })

  test('reports a destructured navigation alias', () => {
    expectsReport('const { goto: navigate } = page\nawait navigate(\'/workspace\')')
  })

  test('allows app.visit', () => {
    expect(lint([
      'import { useApplication } from \'basis/testing\'',
      'const app = await useApplication({ entry: \'./serve.ts\' })',
      'await app.visit(\'/workspace\', async page => page.click(\'button\'))',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows interactions inside a visit', () => {
    expect(lint([
      'await app.visit(\'/workspace\', async page => {',
      '  await page.click(\'button\')',
      '  await page.locator(\'main\').isVisible()',
      '  await page.waitForURL(\'**/workspace\')',
      '})',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows a non-navigation method named reload on another object', () => {
    expect(lint('await cache.reload()')).toHaveLength(0)
  })
})
