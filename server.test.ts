import type { ApplicationHandle } from 'basis/testing'
import { startApplication } from 'basis/testing'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

describe('docs server entrypoint', () => {
  let app: ApplicationHandle

  beforeAll(async () => {
    app = await startApplication({
      cwd: import.meta.dir,
      entry: './server.ts',
      env: { NODE_ENV: 'development' },
      timeoutMs: 15_000,
    })
  }, 30_000)

  afterAll(async () => {
    await app?.stop()
  })

  test('starts from the repository root and serves the documentation application', async () => {
    const response = await Bun.fetch(app.url)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(html.trim().length).toBeGreaterThan(0)
  }, 30_000)
})
