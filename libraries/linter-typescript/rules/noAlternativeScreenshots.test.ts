import { describe, expect, test } from 'bun:test'
import { lintRule } from './complianceTestUtils'

const lint = (code: string) => lintRule('noAlternativeScreenshots', code, 'fixture.test.ts')

const expectsReport = (code: string): void => {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0]?.messageId).toBe('noAlternativeScreenshots')
  expect(messages[0]?.message).toContain('matchScreenshot')
}

describe('noAlternativeScreenshots', () => {
  test('reports page.screenshot', () => {
    expectsReport('await page.screenshot({ path: \'shot.png\' })')
  })

  test('reports a bracketed screenshot call', () => {
    expectsReport('await page[\'screenshot\']()')
  })

  test('reports locator.screenshot', () => {
    expectsReport('await locator.screenshot()')
  })

  test('reports subject.screenshot', () => {
    expectsReport('await subject.screenshot({ path: \'shot.png\' })')
  })

  test('reports toHaveScreenshot', () => {
    expectsReport('await expect(page).toHaveScreenshot()')
  })

  test('reports toMatchImageSnapshot', () => {
    expectsReport('expect(image).toMatchImageSnapshot()')
  })

  test('reports pixelmatch', () => {
    expectsReport('import pixelmatch from \'pixelmatch\'\npixelmatch(left, right, output, 10, 10)')
  })

  test('reports an aliased pixelmatch', () => {
    expectsReport('import { default as compare } from \'pixelmatch\'\ncompare(left, right, output, 10, 10)')
  })

  test('reports a pixelmatch require', () => {
    expectsReport('const pixelmatch = require(\'pixelmatch\')\npixelmatch(left, right, output, 10, 10)')
  })

  test('reports pngjs', () => {
    expectsReport('import { PNG } from \'pngjs\'\nnew PNG({ height: 10, width: 10 })')
  })

  test('reports sharp', () => {
    expectsReport('import sharp from \'sharp\'\nsharp(\'shot.png\')')
  })

  test('reports looks-same', () => {
    expectsReport('import looksSame from \'looks-same\'\nawait looksSame(left, right)')
  })

  test('reports jest-image-snapshot', () => {
    expectsReport('import { toMatchImageSnapshot } from \'jest-image-snapshot\'\ntoMatchImageSnapshot()')
  })

  test('allows type-only image imports', () => {
    expect(lint('import type { PNG } from \'pngjs\'\nconst image: PNG | null = null')).toHaveLength(0)
  })

  test('allows the Basis matcher', () => {
    expect(lint([
      'import { matchScreenshot } from \'basis/testing\'',
      'await matchScreenshot(page, \'home\')',
    ].join('\n'))).toHaveLength(0)
  })

  test('allows ordinary screenshot-free assertions', () => {
    expect(lint('expect(page.url()).toBe(\'http://localhost/\')')).toHaveLength(0)
  })
})
