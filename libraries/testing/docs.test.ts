import { afterAll, beforeAll, expect } from 'bun:test'
import { join } from 'node:path'
import type { ApplicationHandle } from './application'
import { startApplication } from './application'
import { describe, test } from './test'

const root = join(import.meta.dir, '..', '..')

/*
 * The docs `Code` component awaits a shiki dynamic import from esm.sh. Serve a
 * tiny local shiki so the page renders deterministically and offline; the
 * network policy blocks everything else.
 */
const SHIKI_STUB = [
  'export async function codeToHtml(code) {',
  "  const escape = value => value.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))",
  "  return '<pre class=\"shiki\"><code>' + escape(code) + '</code></pre>'",
  '}',
].join('\n')

const STUBS = { 'https://esm.sh/shiki@3.0.0': SHIKI_STUB }

describe('testing/docs', () => {
  let app: ApplicationHandle

  beforeAll(async () => {
    app = await startApplication({
      cwd: root,
      entry: './testing/docs/index.ts',
      timeoutMs: 120_000,
    })
  }, 120_000)

  afterAll(async () => {
    await app.stop()
  })

  test('captures the Button examples', async () => {
    await app.visit('/components/button', { stubs: STUBS }, async page => {
      await page.waitForSelector('.button-examples')
      await expect(page.locator('.button-examples').first()).toMatchScreenshot('button examples', {
        maxDiffPixelRatio: 0.01,
      })
    })
  }, 60_000)

  test('captures the icon grid', async () => {
    await app.visit('/icons', { stubs: STUBS }, async page => {
      await page.waitForSelector('.icon-grid')
      await expect(page.locator('.icon-grid')).toMatchScreenshot('icon grid', {
        maxDiffPixelRatio: 0.01,
      })
    })
  }, 60_000)
})
