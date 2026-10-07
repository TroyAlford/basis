import { join } from 'node:path'
import { matchScreenshot, startApplication, test } from '../../testing'

/**
 * Release the documentation shell's fixed height so a full-page capture is the
 * whole page rather than the viewport.
 */
const FULL_LENGTH = [
  'html, body, .documentation-shell.component { height: auto !important; overflow: visible !important; }',
  '.documentation-shell.component > main, .documentation-shell.component > nav.links { overflow: visible !important; }',
].join('\n')

/** A representative page set: the docs home, component pages, and the new prose. */
const PAGES: [string, string][] = [
  ['/', 'overview'],
  ['/architecture', 'architecture'],
  ['/components/button', 'button'],
  ['/components/component', 'component'],
  ['/components/table', 'table'],
  ['/mixins', 'mixins'],
  ['/contributing', 'contributing'],
  ['/guides', 'guides'],
  ['/reference', 'reference'],
]

/**
 * Proof that Basis's docs server renders its documentation — the existing
 * component/idea pages plus the new prose — full length and styled, with the
 * Mermaid diagram rendered through the real runtime.
 */
test('captures the docs pages full length', async () => {
  const app = await startApplication({
    cwd: join(import.meta.dir, '..', '..', '..'),
    entry: './server.ts',
    readyPath: '/',
    timeoutMs: 60_000,
  })

  try {
    for (const [path, hint] of PAGES) {
      await app.visit(path, { allow: ['esm.sh'] }, async page => {
        await page.addStyleTag({ content: FULL_LENGTH })
        if (await page.locator('.mermaid').count() > 0) {
          await page.waitForSelector('.mermaid svg', { timeout: 30_000 })
        }
        await page.waitForTimeout(800)
        await matchScreenshot(page.locator('.documentation-shell.component'), `page ${hint}`)
      })
    }
  } finally {
    await app.stop()
  }
}, 240_000)
