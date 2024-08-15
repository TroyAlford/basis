import { describe, expect, test } from 'bun:test'
import { isNil } from './isNil'

describe('isNil', () => {
	test('returns true for nil values', () => {
		expect(isNil(null)).toBe(true)
		expect(isNil(undefined)).toBe(true)
		expect(isNil(NaN)).toBe(true)
	})

	test('returns false for other falsy values', () => {
		expect(isNil(false)).toBe(false)
		expect(isNil(0)).toBe(false)
		expect(isNil('')).toBe(false)
	})
})
