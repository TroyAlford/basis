import { afterAll, beforeAll, expect } from 'bun:test'
import { join } from 'node:path'
import type { Page } from 'playwright'
import type { ApplicationHandle } from './application'
import { startApplication } from './application'
import { withPage } from './browser'
import { blockExternalRequests, stubRequest } from './network'
import { describe, test } from './test'

const root = join(import.meta.dir, '..', '..')

/*
 * The docs `Code` component dynamically imports shiki from esm.sh and awaits it
 * at module scope. Serve a tiny local shiki so the page renders deterministically
 * without the network (and without that CDN dependency).
 */
const SHIKI_STUB = [
  'export async function codeToHtml(code) {',
  "  const escape = value => value.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))",
  "  return '<pre class=\"shiki\"><code>' + escape(code) + '</code></pre>'",
  '}',
].join('\n')

/**
 * Make the page deterministic: block external hosts, then stub shiki.
 * @param page - The page to prepare.
 */
async function prepare(page: Page): Promise<void> {
  await blockExternalRequests(page)
  await stubRequest(page, 'https://esm.sh/shiki@3.0.0', { body: SHIKI_STUB })
}

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
    await withPage(async page => {
      await prepare(page)
      await page.goto(`${app.url}/components/button`)
      await page.waitForSelector('.button-examples')
      await expect(page.locator('.button-examples').first()).toMatchScreenshot('button examples', {
        maxDiffPixelRatio: 0.01,
      })
    })
  }, 60_000)

  test('captures the icon grid', async () => {
    await withPage(async page => {
      await prepare(page)
      await page.goto(`${app.url}/icons`)
      await page.waitForSelector('.icon-grid')
      await expect(page.locator('.icon-grid')).toMatchScreenshot('icon grid', {
        maxDiffPixelRatio: 0.01,
      })
    })
  }, 60_000)
})
