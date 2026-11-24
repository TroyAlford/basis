import { test } from 'bun:test'
import { expect } from 'bun:test'
import { useApplication } from './application'

const fixture = new URL('../../testing/native-production/shell', import.meta.url).pathname

/**
 * Run one generated-shell diagnostic variant in a real browser.
 * @param variant - Plugin/vendor variant.
 * @param warm - Shell warmup ordering.
 */
async function runVariant(variant: 'A' | 'B' | 'C' | 'D', warm: 'concurrent' | 'sequential'): Promise<void> {
  const app = await useApplication({
    cwd: fixture,
    development: false,
    entry: './serve.ts',
    env: { NATIVE_VARIANT: variant, NATIVE_WARM: warm },
    timeoutMs: 10_000,
  })

  try {
    const html = await Promise.race([
      Bun.fetch(app.url).then(async response => ({
        body: (await response.text()).slice(0, 500),
        status: response.status,
      })),
      Bun.sleep(5_000).then(() => ({ body: 'timeout', status: 599 })),
    ])
    process.stdout.write(`[native-shell] ${variant} warm=${warm} html=${html.status} ${JSON.stringify(html.body)}\n`)

    const sockets: string[] = []
    await app.visit('/', {
      init: page => {
        page.on('websocket', socket => { sockets.push(socket.url()) })
      },
    }, async page => {
      await page.waitForSelector('h1')
      expect(await page.textContent('h1')).toBe('Shell 0')
      await page.click('button')
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Shell 1')
    })
    expect(sockets).toEqual([])
  } finally {
    await app.stop()
  }
}

test('variant A: generated shell without vendor plugin', async () => {
  await runVariant('A', 'concurrent')
}, 45_000)

test('variant B: vendor plugin resolving no specifiers', async () => {
  await runVariant('B', 'concurrent')
}, 45_000)

test('variant C: actual vendor specifiers, concurrent warmup', async () => {
  await runVariant('C', 'concurrent')
}, 45_000)

test('variant D: actual vendor specifiers, sequential warmup', async () => {
  await runVariant('D', 'sequential')
}, 45_000)
