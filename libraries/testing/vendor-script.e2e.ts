import { useApplication } from 'basis/testing'
import { expect, setDefaultTimeout } from 'bun:test'
import { join } from 'node:path'
import { describe, test } from './test'

setDefaultTimeout(60_000)

const root = join(import.meta.dir, '..', '..')
const fixture = './testing/vendor/serve.ts'

describe('testing/vendor-script', () => {
  test('proves Bun absorbs direct pre-scripts but preserves the document.write loader', async () => {
    const application = await useApplication({ cwd: root, entry: fixture })

    /*
     * Bun's HTML bundler resolves a direct `/assets/vendor/vendor.js` tag as a
     * source entry. The standard vendor file lives outside that URL on disk, so
     * the direct page fails to build instead of loading a separately cached
     * artifact. This is the failure the loader exists to avoid.
     */
    const direct = await Bun.fetch(`${application.url}/direct`)
    expect(direct.status).toBe(500)
    expect(await direct.text()).not.toContain('id="result"')

    await application.visit('/direct', async page => {
      await page.waitForLoadState('domcontentloaded')
      expect(await page.locator('#result').count()).toBe(0)
    })

    await application.visit('/document-write', async page => {
      await page.waitForFunction(() => document.querySelector('#result')?.textContent === 'loaded')
      expect(await page.locator('#result').textContent()).toBe('loaded')
    })
  })
})
