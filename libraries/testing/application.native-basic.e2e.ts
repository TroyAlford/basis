import { expect, test } from 'bun:test'
import { useApplication } from './application'

const fixture = new URL('../../testing/native-production/basic', import.meta.url).pathname

/**
 * Verify one basic fixture in a real browser.
 * @param entry - Fixture server entrypoint.
 */
async function verify(entry: string): Promise<void> {
  const app = await useApplication({ cwd: fixture, entry, timeoutMs: 15_000 })

  try {
    const sockets: string[] = []
    const developmentRequests: string[] = []
    await app.visit('/', {
      init: page => {
        page.on('websocket', socket => { sockets.push(socket.url()) })
        page.on('request', request => {
          if (request.url().includes('/_bun/')) developmentRequests.push(request.url())
        })
      },
    }, async page => {
      await page.waitForSelector('[data-testid="basic"]')
      expect(await page.textContent('[data-testid="basic"]')).toBe('native-ts-ok')
      await page.click('[data-testid="basic"]')
      expect(await page.getAttribute('[data-testid="basic"]', 'data-clicked')).toBe('yes')
    })

    expect(sockets).toEqual([])
    expect(developmentRequests).toEqual([])
    const firstResponse = await Bun.fetch(app.url)
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.text()
    const secondResponse = await Bun.fetch(app.url)
    expect(secondResponse.status).toBe(200)
    const second = await secondResponse.text()
    expect(first).toBe(second)
  } finally {
    await app.stop()
  }
}

test('serves a standalone TypeScript HTML application in production mode', async () => {
  await verify('./serve.ts')
}, 45_000)

test('has the same basic result through a Bun.serve monkeypatch', async () => {
  await verify('./serve-monkey.ts')
}, 45_000)
