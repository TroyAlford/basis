import { describe, expect,test } from 'bun:test'
import { deepEquals } from './deepEquals'

describe('deepEquals', () => {
	test('compares two objects', () => {
		expect(deepEquals({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
		expect(deepEquals({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false)
		expect(deepEquals({ a: 1, b: 2 }, { a: 1 })).toBe(false)
	})

	test('compares two arrays', () => {
		expect(deepEquals([1, 2], [1, 2])).toBe(true)
		expect(deepEquals([1, 2], [1, 3])).toBe(false)
		expect(deepEquals([1, 2], [1])).toBe(false)
	})

	test('compares two nested objects', () => {
		expect(deepEquals({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true)
		expect(deepEquals({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
		expect(deepEquals({ a: { b: 1 } }, { a: { c: 1 } })).toBe(false)
	})

	test('compares two nested arrays', () => {
		expect(deepEquals([[1], [2]], [[1], [2]])).toBe(true)
		expect(deepEquals([[1], [2]], [[1], [3]])).toBe(false)
		expect(deepEquals([[1], [2]], [[1], []])).toBe(false)
	})

	test('compares two mixed objects', () => {
		expect(deepEquals({ a: [1, 2] }, { a: [1, 2] })).toBe(true)
		expect(deepEquals({ a: [1, 2] }, { a: [1, 3] })).toBe(false)
		expect(deepEquals({ a: [1, 2] }, { a: [1] })).toBe(false)
	})

	test('compares two mixed arrays', () => {
		expect(deepEquals([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 2 }])).toBe(true)
		expect(deepEquals([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 3 }])).toBe(false)
		expect(deepEquals([{ a: 1 }, { b: 2 }], [{ a: 1 }, { c: 2 }])).toBe(false)
	})

	test('compares two objects with out-of-order keys', () => {

		expect(deepEquals({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
		expect(deepEquals({ a: 1, b: 2 }, { a: 3, b: 2 })).toBe(false)

	})

	test('compares scalar values', () => {
		expect(deepEquals(1, 1)).toBe(true)
		expect(deepEquals(1, 2)).toBe(false)
		expect(deepEquals('foo', 'foo')).toBe(true)
		expect(deepEquals('foo', 'bar')).toBe(false)
		expect(deepEquals(true, true)).toBe(true)
		expect(deepEquals(true, false)).toBe(false)
	})
})
