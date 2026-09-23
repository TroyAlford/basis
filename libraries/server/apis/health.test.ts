import { describe, expect, test } from 'bun:test'
import { health } from './health'

describe('health', () => {
  test('reports ok with Bun diagnostics when ready', async () => {
    const response = health({ status: 'ok', version: 'rev' })

    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body).toMatchObject({ status: 'ok', version: 'rev' })
    expect(body.bun).toBe(Bun.version)
  })

  test('reports 503 starting before readiness', async () => {
    const response = health({ status: 'starting', version: 'rev' })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ status: 'starting', version: 'rev' })
  })

  test('reports 503 error with the failure after a failed build', async () => {
    const response = health({ error: 'boom', status: 'error', version: 'rev' })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'boom', status: 'error', version: 'rev' })
  })
})
