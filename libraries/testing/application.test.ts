import { afterAll, beforeAll, expect } from 'bun:test'
import { join } from 'node:path'
import type { ApplicationHandle } from './application'
import { startApplication } from './application'
import { describe, test } from './test'

const root = join(import.meta.dir, '..', '..')

describe('testing/application', () => {
  let app: ApplicationHandle

  beforeAll(async () => {
    app = await startApplication({
      cwd: root,
      entry: './testing/e2e/index.ts',
      timeoutMs: 60_000,
    })
  }, 60_000)

  afterAll(async () => {
    await app.stop()
  })

  test('serves the application under test', async () => {
    await app.visit('/', async page => {
      expect(await page.locator('h1').textContent()).toBe('Application')
    })
  }, 30_000)

  test('seeds state before navigation', async () => {
    await app.visit('/', {
      init: page => page.addInitScript(() => localStorage.setItem('basis:probe', 'seeded')),
    }, async page => {
      expect(await page.evaluate(() => localStorage.getItem('basis:probe'))).toBe('seeded')
    })
  }, 30_000)

  test('captures a deterministic element from the page', async () => {
    await app.visit('/', async page => {
      await expect(page.locator('[data-testid="swatch"]')).toMatchScreenshot()
    })
  }, 30_000)
})
