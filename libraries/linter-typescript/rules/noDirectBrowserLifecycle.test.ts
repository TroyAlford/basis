import { describe, expect, test } from 'bun:test'
import { lintRule } from './complianceTestUtils'

const lint = (code: string) => lintRule('noDirectBrowserLifecycle', code, 'fixture.test.ts')

const expectsReport = (code: string): void => {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noDirectBrowserLifecycle')
  expect(messages[0]?.message).toContain('useApplication')
}

describe('noDirectBrowserLifecycle', () => {
  test('reports chromium.launch', () => {
    expectsReport('import { chromium } from \'playwright\'\nawait chromium.launch()')
  })

  test('reports an aliased browser launcher', () => {
    expectsReport('import { chromium as browser } from \'playwright\'\nawait browser.launch()')
  })

  test('reports a namespace browser launcher', () => {
    expectsReport('import * as playwright from \'playwright\'\nawait playwright.firefox.launch()')
  })

  test('reports webkit.connect', () => {
    expectsReport('import { webkit } from \'playwright-core\'\nawait webkit.connect(\'ws://localhost\')')
  })

  test('reports connectOverCDP', () => {
    expectsReport('import { chromium } from \'playwright\'\nawait chromium.connectOverCDP(\'http://localhost\')')
  })

  test('reports launchPersistentContext', () => {
    expectsReport('import { chromium } from \'playwright\'\nawait chromium.launchPersistentContext(\'/tmp/profile\')')
  })

  test('reports a destructured require', () => {
    expectsReport('const { chromium } = require(\'playwright\')\nawait chromium.launch()')
  })

  test('reports a member require', () => {
    expectsReport('await require(\'playwright\').chromium.launch()')
  })

  test('reports an aliased lifecycle method', () => {
    expectsReport([
      'import { chromium } from \'playwright\'',
      'const launch = chromium.launch',
      'await launch()',
    ].join('\n'))
  })

  test('reports destructuring the lifecycle method', () => {
    expectsReport([
      'import { chromium } from \'playwright\'',
      'const { launch } = chromium',
      'await launch()',
    ].join('\n'))
  })

  test('reports puppeteer.launch', () => {
    expectsReport('import puppeteer from \'puppeteer\'\nawait puppeteer.launch()')
  })

  test('reports a Playwright run-server process', () => {
    expectsReport('Bun.spawn([\'bunx\', \'playwright\', \'run-server\'])')
  })

  test('reports a Playwright run-server through the Basis runner', () => {
    expectsReport('import { runAsync } from \'basis/utilities\'\nrunAsync(\'npx\', [\'playwright\', \'run-server\'])')
  })

  test('allows type-only Playwright imports', () => {
    expect(lint('import type { Page } from \'playwright\'\nconst page: Page | null = null')).toHaveLength(0)
  })

  test('allows the Basis application fixture', () => {
    expect(lint([
      'import { useApplication } from \'basis/testing\'',
      'await useApplication({ visit: async ({ page }) => page.goto(\'/\') })',
    ].join('\n'))).toHaveLength(0)
  })
})
