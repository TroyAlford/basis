import { afterEach, describe, expect, test } from 'bun:test'
import { managedDatabaseIdentity } from './Database'

const original = Bun.env.SERVICE_NAME

afterEach(() => {
  if (original === undefined) delete Bun.env.SERVICE_NAME
  else Bun.env.SERVICE_NAME = original
})

describe('managedDatabaseIdentity', () => {
  test('is stable for the same normalized installation directory', () => {
    const identity = managedDatabaseIdentity('/srv/apps/a')
    expect(identity).toBe(managedDatabaseIdentity('/srv/apps/a/'))
  })

  test('separates different installation directories', () => {
    expect(managedDatabaseIdentity('/srv/apps/a'))
      .not.toBe(managedDatabaseIdentity('/srv/apps/b'))
  })

  test('ignores SERVICE_NAME', () => {
    const identity = managedDatabaseIdentity('/srv/apps/a')
    Bun.env.SERVICE_NAME = 'mtg_prod'
    expect(managedDatabaseIdentity('/srv/apps/a')).toBe(identity)
  })
})
