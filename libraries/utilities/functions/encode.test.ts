import { describe, expect, test } from 'bun:test'
import { encode, decode } from './encode'

describe('encode/decode', () => {
	test.each([
		[1, 'H-MQ'],
		[2, 'H-Mg'],
		[3, 'H-Mw'],
		[[1, 2, 3, 'a', 'b', 'c'], 'H-WzEsMiwzLCJhIiwiYiIsImMiXQ'],
		['hello', 'H-ImhlbGxvIg'],
		[true, 'H-dHJ1ZQ'],
		[false, 'H-ZmFsc2U'],
		[{ a: 1, b: 2 }, 'H-eyJhIjoxLCJiIjoyfQ'],
	])('handles %p', (value, expected: `H-${string}`) => {
		expect(encode(value)).toEqual(expected)
		expect(decode(expected)).toEqual(value)
	})

	test.each([
		[null, null],
		[undefined, null],
	])('should return null for %p', (value, expected) => {
		expect(encode(value)).toEqual(expected)
	})
})