import { beforeAll, expect } from 'bun:test'
import { join } from 'node:path'
import type { ApplicationHandle, StartApplicationOptions } from './application'
import { useApplication } from './application'
import { matchScreenshot } from './matchScreenshot'
import { describe, test } from './test'

const root = join(import.meta.dir, '..', '..')

const options = {
  cwd: root,
  entry: './testing/e2e/index.ts',
  timeoutMs: 60_000,
} satisfies StartApplicationOptions

describe('testing/application', () => {
  let app: ApplicationHandle

  beforeAll(async () => {
    app = await useApplication(options)
  }, 60_000)

  test('serves the application under test', async () => {
    await app.visit('/', async page => {
      expect(await page.locator('h1').textContent()).toBe('Application')
    })
  }, 30_000)

  test('shares one run-scoped application across concurrent callers', async () => {
    const [first, second] = await Promise.all([
      useApplication(options),
      useApplication(options),
    ])

    expect(first).toBe(second)
    expect(first).toBe(app)
  })

  test('seeds state before navigation', async () => {
    await app.visit('/', {
      init: page => page.addInitScript(() => localStorage.setItem('basis:probe', 'seeded')),
    }, async page => {
      expect(await page.evaluate(() => localStorage.getItem('basis:probe'))).toBe('seeded')
    })
  }, 30_000)

  test('captures a deterministic element from the page', async () => {
    await app.visit('/', async page => {
      await matchScreenshot(page.locator('[data-testid="swatch"]'))
    })
  }, 30_000)
})
