import { describe, expect, test } from 'bun:test'
import { randomHash } from './randomHash'

describe('randomHash', () => {
  test('generates random hash strings', () => {
    const hash1 = randomHash()
    const hash2 = randomHash()

    // Should generate different hashes
    expect(hash1).not.toBe(hash2)

    // Should be strings
    expect(typeof hash1).toBe('string')
    expect(typeof hash2).toBe('string')

    // Should not contain hyphens (they're removed)
    expect(hash1).not.toContain('-')
    expect(hash2).not.toContain('-')

    // Should not be empty
    expect(hash1.length).toBeGreaterThan(0)
    expect(hash2.length).toBeGreaterThan(0)
  })

  test('generates reasonable length hashes', () => {
    const hashes = Array.from({ length: 10 }, () => randomHash())
    const lengths = hashes.map(h => h.length)

    // All hashes should have reasonable lengths (not too short, not too long)
    lengths.forEach(length => {
      expect(length).toBeGreaterThan(0)
      expect(length).toBeLessThan(50) // Reasonable upper bound
    })
  })
})
