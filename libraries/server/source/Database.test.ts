import { afterEach, describe, expect, test } from 'bun:test'
import { managedDatabaseIdentity } from './Database'

const original = process.env.SERVICE_NAME

afterEach(() => {
  if (original === undefined) delete process.env.SERVICE_NAME
  else process.env.SERVICE_NAME = original
})

describe('managedDatabaseIdentity', () => {
  test('uses SERVICE_NAME when present', () => {
    process.env.SERVICE_NAME = 'mtg_prod'
    expect(managedDatabaseIdentity('/srv/apps/a')).toBe('mtg_prod')
    expect(managedDatabaseIdentity('/srv/apps/b')).toBe('mtg_prod')
  })

  test('falls back to a stable per-root hash when SERVICE_NAME is absent', () => {
    delete process.env.SERVICE_NAME
    const identity = managedDatabaseIdentity('/srv/apps/a')
    expect(identity).toBe(managedDatabaseIdentity('/srv/apps/a'))
    expect(identity).not.toBe(managedDatabaseIdentity('/srv/apps/b'))
    expect(identity).toMatch(/^[a-f0-9]{16}$/)
  })
})
