import { useApplication } from 'basis/testing'
import { expect, setDefaultTimeout } from 'bun:test'
import { join } from 'node:path'
import { describe, test } from './test'

setDefaultTimeout(60_000)

const root = join(import.meta.dir, '..', '..')
const fixture = './testing/vendor/serve.ts'

describe('testing/vendor-script', () => {
  test('proves direct pre-scripts fail while the server marker injects the vendor request', async () => {
    const directApplication = await useApplication({ cwd: root, entry: fixture })

    /*
     * Bun's HTML bundler resolves a direct local `/assets/vendor/vendor.js`
     * tag as a source entry. The standard vendor file lives outside that URL on
     * disk, so the direct page fails to build instead of loading a separately
     * cached artifact. The server injects an absolute-origin script instead.
     */
    const direct = await Bun.fetch(`${directApplication.url}/direct`)
    expect(direct.status).toBe(500)
    expect(await direct.text()).not.toContain('id="result"')

    await directApplication.visit('/direct', async page => {
      await page.waitForLoadState('domcontentloaded')
      expect(await page.locator('#result').count()).toBe(0)
    })
    await directApplication.stop()

    const application = await useApplication({ cwd: root, entry: './testing/server/serve.ts' })
    const html = await Bun.fetch(`${application.url}/`).then(response => response.text())
    expect(html).toMatch(/<script src="http:\/\/127\.0\.0\.1:\d+\/assets\/vendor\/vendor\.js"></)
    expect(html).not.toContain('document.write')
    expect(html.indexOf('/assets/vendor/vendor.js')).toBeLessThan(html.indexOf('type="module"'))

    await application.visit('/', async page => {
      expect(await page.locator('[data-testid="application"]').textContent()).toContain('Basis managed server')
    })
  })
})
