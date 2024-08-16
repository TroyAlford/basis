import { describe, expect, test } from 'bun:test'
import { get } from './get'

describe('get', () => {
	test('gets a value from an object', () => {
		expect(get('a', { a: 1, b: 2 })).toBe(1)
		expect(get('b', { a: 1, b: 2 })).toBe(2)
	})

	test('gets a value from a nested object', () => {
		expect(get('a.b', { a: { b: 1 } })).toBe(1)
		expect(get('a.b', { a: { c: 1 } })).toBe(undefined)
	})

	test('gets a value from an array', () => {
		expect(get('0', [1, 2])).toBe(1)
		expect(get('1', [1, 2])).toBe(2)
	})

	test('gets a value from a nested array', () => {
		expect(get('0.0', [[1], [2]])).toBe(1)
		expect(get('1.0', [[1], [2]])).toBe(2)
	})

	test('gets a value from a mixed object', () => {
		expect(get('a.0', { a: [1, 2] })).toBe(1)
		expect(get('a.1', { a: [1, 2] })).toBe(2)
	})
})
