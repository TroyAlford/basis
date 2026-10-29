import { afterEach, describe, expect, test } from 'bun:test'
import { managedDatabaseIdentity } from './Database'

const original = Bun.env.SERVICE_NAME

afterEach(() => {
  if (original === undefined) delete Bun.env.SERVICE_NAME
  else Bun.env.SERVICE_NAME = original
})

describe('managedDatabaseIdentity', () => {
  test('combines SERVICE_NAME and the normalized application root', () => {
    Bun.env.SERVICE_NAME = 'mtg_prod'
    const identity = managedDatabaseIdentity('/srv/apps/a')
    expect(identity).toBe(managedDatabaseIdentity('/srv/apps/a/'))
    expect(identity).not.toBe(managedDatabaseIdentity('/srv/apps/b'))
    expect(identity).toMatch(/^[a-f0-9]{16}$/)
  })

  test('falls back to a stable per-root hash when SERVICE_NAME is absent', () => {
    delete Bun.env.SERVICE_NAME
    const identity = managedDatabaseIdentity('/srv/apps/a')
    expect(identity).toBe(managedDatabaseIdentity('/srv/apps/a'))
    expect(identity).not.toBe(managedDatabaseIdentity('/srv/apps/b'))
    expect(identity).toMatch(/^[a-f0-9]{16}$/)
  })
})
