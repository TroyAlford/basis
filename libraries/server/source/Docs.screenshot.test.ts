import { join } from 'node:path'
import { matchScreenshot, startApplication, test } from '../../testing'

/** Deterministic stand-in for the Mermaid runtime loaded from esm.sh. */
const MERMAID_STUB = [
  'export default {',
  '  initialize() {},',
  '  async run({ nodes }) {',
  "    for (const node of nodes) node.innerHTML = '<svg width=\"240\" height=\"72\" xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"240\" height=\"72\" rx=\"8\" fill=\"#eef6ff\" stroke=\"#0070f3\"/><text x=\"16\" y=\"42\" fill=\"#0070f3\" font-family=\"Ubuntu, sans-serif\" font-size=\"16\">flowchart stub</text></svg>'",
  '  },',
  '}',
].join('\n')

/**
 * Proof that Basis's own docs server renders the documentation at the site
 * root: the index and the architecture page, including its Mermaid diagram.
 */
test('serves Basis documentation at the root', async () => {
  const app = await startApplication({
    cwd: join(import.meta.dir, '..', '..', '..'),
    entry: './server.ts',
    readyPath: '/',
    timeoutMs: 60_000,
  })

  try {
    await app.visit('/', page => matchScreenshot(page))
    await app.visit(
      '/architecture',
      { stubs: { 'https://esm.sh/mermaid@11': MERMAID_STUB } },
      page => matchScreenshot(page),
    )
  } finally {
    await app.stop()
  }
}, 90_000)
