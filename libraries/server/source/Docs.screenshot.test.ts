import { join } from 'node:path'
import { matchScreenshot, startApplication, test } from '../../testing'

/**
 * Proof that a running Basis Server renders the repository documentation tree:
 * the index and a content page, captured from the live `/docs` route.
 */
test('serves the repository documentation', async () => {
  const app = await startApplication({
    cwd: join(import.meta.dir, '..', '..', '..'),
    entry: './testing/e2e/docs.ts',
    readyPath: '/docs',
    timeoutMs: 60_000,
  })

  try {
    await app.visit('/docs', page => matchScreenshot(page))
    await app.visit('/docs/architecture', page => matchScreenshot(page))
  } finally {
    await app.stop()
  }
}, 90_000)
