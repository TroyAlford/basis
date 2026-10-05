import { describe, expect, test } from 'bun:test'
import { encryptIdentity, readIdentity } from './identity'

/** A stand-in provider secret; the real one is a provider/client secret. */
const SECRET = 'provider-secret-for-tests'

/** User ids the cookie value might carry. */
const USER_IDS = ['1', '123456789012345678', 'user_abc-123', 'troyalford']

describe('encryptIdentity', () => {
  test('round-trips every user id', () => {
    for (const userId of USER_IDS) {
      const value = encryptIdentity(userId, SECRET)
      expect(readIdentity(value, SECRET)).toBe(userId)
    }
  })

  test('prefixes the value with the scheme version', () => {
    expect(encryptIdentity('1', SECRET).startsWith('v1.')).toBe(true)
  })

  test('encodes the payload as base64url', () => {
    expect(encryptIdentity('1', SECRET)).toMatch(/^v1\.[A-Za-z0-9_-]+$/)
  })

  test('is non-deterministic but still decrypts', () => {
    const first = encryptIdentity('1', SECRET)
    const second = encryptIdentity('1', SECRET)
    expect(first).not.toBe(second)
    expect(readIdentity(first, SECRET)).toBe('1')
    expect(readIdentity(second, SECRET)).toBe('1')
  })
})

describe('readIdentity', () => {
  test('returns null for a missing value', () => {
    expect(readIdentity(null, SECRET)).toBeNull()
  })

  test('returns null for a wrong secret', () => {
    expect(readIdentity(encryptIdentity('1', SECRET), 'a-different-secret')).toBeNull()
  })

  test('returns null when the payload is tampered with', () => {
    const value = encryptIdentity('1', SECRET)
    const replacement = value.endsWith('A') ? 'B' : 'A'
    expect(readIdentity(`${value.slice(0, -1)}${replacement}`, SECRET)).toBeNull()
  })

  test('returns null when the version prefix is unknown', () => {
    const value = encryptIdentity('1', SECRET)
    expect(readIdentity(`v2${value.slice(2)}`, SECRET)).toBeNull()
  })

  test('returns null when the value is truncated', () => {
    const value = encryptIdentity('1', SECRET)
    expect(readIdentity(value.slice(0, -4), SECRET)).toBeNull()
  })

  test('returns null for malformed values', () => {
    const malformed = ['', 'v1', 'v1.', 'v1.!!!', 'v1.a', 'plain-value', 'v2.abc']
    for (const value of malformed) {
      expect(readIdentity(value, SECRET)).toBeNull()
    }
  })

  test('never returns a different user id under a wrong secret', () => {
    for (const userId of USER_IDS) {
      const value = encryptIdentity(userId, SECRET)
      expect(readIdentity(value, `${SECRET}-other`)).toBeNull()
    }
  })
})
