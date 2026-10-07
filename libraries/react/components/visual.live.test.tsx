import { join } from 'node:path'
import { matchScreenshot, test, useApplication } from '../../testing'

/**
 * Visual regression for the components whose meaningful state only exists after
 * mount, rendered live on the component stage: the resolved `Await`, the
 * rendered `Mermaid` diagram, and the placed `Tooltip`. Everything else is
 * captured statically in `visual.test.tsx`.
 */

/** Antialiasing differs across machines; absorb it the way the other snapshots do. */
const TOLERANCE = { maxDiffPixelRatio: 0.02 }

/** Each stage path and the snapshot it produces. */
const STAGES: [string, string][] = [
  ['await', 'Await'],
  ['mermaid', 'Mermaid'],
  ['tooltip', 'Tooltip'],
]

test('captures mounted components', async () => {
  const app = await useApplication({
    cwd: join(import.meta.dir, '..', '..', '..'),
    entry: './testing/components/index.ts',
    timeoutMs: 120_000,
  })

  for (const [path, name] of STAGES) {
    await app.visit(`/${path}`, { allow: ['esm.sh'] }, async page => {
      await page.waitForSelector('#stage')
      if (path === 'await') {
        await page.waitForFunction(() => document.querySelector('#stage')?.textContent?.includes('Loaded'))
      }
      if (path === 'mermaid') {
        await page.waitForSelector('#stage .diagram svg', { timeout: 30_000 })
      }
      await matchScreenshot(page.locator('#stage'), name, TOLERANCE)
    })
  }
}, 120_000)
