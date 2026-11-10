import { describe, expect, test } from 'bun:test'
import { checksum } from './checksum'

describe('checksum', () => {
  test('hashes raw strings and bytes with SHA-256', () => {
    expect(checksum('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(checksum(new TextEncoder().encode('hello')))
      .toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  test('uses stable structured ordering by default', () => {
    expect(checksum({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(checksum({ a: 1, b: { c: 2, d: 3 } }))
  })

  test('can preserve insertion-order serialization for legacy byte layouts', () => {
    const first = Object.fromEntries([['a', 1], ['b', 2]])
    const second = Object.fromEntries([['b', 2], ['a', 1]])
    expect(checksum(first, { stable: false })).not.toBe(checksum(second, { stable: false }))
  })
})
