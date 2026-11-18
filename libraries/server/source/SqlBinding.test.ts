import { describe, expect, test } from 'bun:test'
import { bindPlaceholders, shiftPlaceholders } from './SqlBinding'

describe('SQL placeholder binding', () => {
  test('binds multi-digit placeholders without prefix collisions', () => {
    const values = Array.from({ length: 12 }, (_, index) => index + 1)
    expect(bindPlaceholders('$1 AND $10 AND $2 AND $12', values, value => `v${value}`))
      .toBe('v1 AND v10 AND v2 AND v12')
  })

  test('rebases placeholders in one pass', () => {
    expect(shiftPlaceholders('$1 AND $10 AND $2', 3))
      .toBe('$4 AND $13 AND $5')
  })
})
