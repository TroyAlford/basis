import { describe, test, expect } from 'bun:test'
import { TimeComponents, parseMilliseconds } from './parseMilliseconds'

describe('parseMilliseconds', () => {
	const ZERO: TimeComponents = {
		days: 0,
		hours: 0,
		minutes: 0,
		ms: 0,
		seconds: 0,
		sign: 1,
		weeks: 0,
		years: 0,
	}

	test.each([
		[1, { ms: 1 }],
		[1500, { ms: 500, seconds: 1 }],
		[250_000, { minutes: 4, ms: 0, seconds: 10 }],
	])('should parse %p correctly', (actual, expected) => {
		expect(parseMilliseconds(actual)).toEqual({ ...ZERO, ...expected })
		expect(parseMilliseconds(-actual)).toEqual({ ...ZERO, ...expected, sign: -1 })
	})

	test('zero', () => {
		expect(parseMilliseconds(0)).toEqual(ZERO)
		expect(parseMilliseconds(-0)).toEqual(ZERO)
	})

	test.each([
		[NaN, ZERO],  // Not a number
		[Infinity, ZERO],  // Infinite values
		[-Infinity, ZERO],  // Negative infinite values
		[null, ZERO],  // Null
	])('should handle invalid input %p correctly', (actual, expected) => {
		const result = parseMilliseconds(actual)
		expect(result).toEqual(expected)
	})
})