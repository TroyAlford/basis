import { join } from 'node:path'
import { matchScreenshot, startApplication, test } from '../../testing'

/**
 * Release the documentation shell's fixed height so a full-page capture is the
 * whole page rather than the viewport, mirroring how the docs app releases its
 * shell for whole-page snapshots.
 */
const FULL_LENGTH = [
  'html, body, .documentation-shell.component { height: auto !important; overflow: visible !important; }',
  '.documentation-shell.component > main, .documentation-shell.component > nav.links { overflow: visible !important; }',
].join('\n')

/** Every documentation page Basis ships, with a snapshot hint. */
const PAGES: [string, string][] = [
  ['/', 'index'],
  ['/architecture', 'architecture'],
  ['/contributing', 'contributing'],
  ['/guides', 'guides'],
  ['/reference', 'reference'],
]

/**
 * Proof that Basis's docs server renders every page to a styled, full-length
 * document at the site root, including its Mermaid diagram. `esm.sh` is allowed
 * so the diagram renders through the real Mermaid runtime rather than a stub.
 */
test('captures every docs page full length', async () => {
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
        await page.waitForTimeout(1000)
        await matchScreenshot(page.locator('.documentation-shell.component'), `page ${hint}`)
      })
    }
  } finally {
    await app.stop()
  }
}, 180_000)
