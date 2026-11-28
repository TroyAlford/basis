import { useApplication } from 'basis/testing'
import { describe, expect, test } from 'bun:test'

describe('docs server entrypoint', () => {
  test('starts from the repository root and serves the documentation application', async () => {
    const application = await useApplication({
      cwd: import.meta.dir,
      entry: './server.ts',
      env: { NODE_ENV: 'development' },
      timeoutMs: 15_000,
    })

    const response = await Bun.fetch(application.url)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(html.trim().length).toBeGreaterThan(0)
  }, 30_000)
})
