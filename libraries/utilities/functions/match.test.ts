import { describe, expect, mock, test } from 'bun:test'
import { _, match } from './match'

describe('match', () => {
	describe('strings', () => {
		test('exact', () => {
			const yes = match('hello')
				.when('hello').then(true)
				.else(false)
			expect(yes).toBe(true)

			const no = match('hello')
				.when('world').then(true)
				.else(false)
			expect(no).toBe(false)
		})

		test('regex', () => {
			const yes = match('hello')
				.when(/ell/).then(true)
				.else(false)
			expect(yes).toBe(true)

			const no = match('hello')
				.when(/world/).then(true)
				.else(false)
			expect(no).toBe(false)
		})
	})

	describe('numbers', () => {
		test('exact', () => {
			const yes = match(42)
				.when(42).then(true)
				.else(false)
			expect(yes).toBe(true)

			const no = match(42)
				.when(43).then(true)
				.else(false)
			expect(no).toBe(false)
		})

		test('min', () => {
			const yes = match(42)
				.when({ min: 23 }).then(true)
				.else(false)
			expect(yes).toBe(true)

			const no = match(42)
				.when({ min: 69 }).then(true)
				.else(false)
			expect(no).toBe(false)
		})

		test('max', () => {
			const yes = match(42)
				.when({ max: 69 }).then(true)
				.else(false)
			expect(yes).toBe(true)

			const no = match(42)
				.when({ max: 23 }).then(true)
				.else(false)
			expect(no).toBe(false)
		})
	})

	describe('objects', () => {
		test('partial object match', () => {
			const yes = match({ a: 1, b: 2 })
				.when({ a: 1 }).then(true)
				.else(false)
			expect(yes).toBe(true)

			const no = match({ a: 1, b: 2 })
				.when({ a: 2 }).then(true)
				.else(false)
			expect(no).toBe(false)
		})

		test('exact object match', () => {
			const yes = match({ a: 1, b: 2 })
				.when({ a: 1, b: 2 }).then(true)
				.else(false)
			expect(yes).toBe(true)

			const no = match({ a: 1, b: 2 })
				.when({ a: 1, b: 3 }).then(true)
				.else(false)
			expect(no).toBe(false)
		})
	})

	describe('arrays', () => {
		test('exact array match', () => {
			const yes = match([1, 2, 3])
				.when([1, 2, 3]).then(true)
				.else(false)
			expect(yes).toBe(true)

			const no = match([1, 2, 3])
				.when([1, 2, _]).then(true)
				.else(false)
			expect(no).toBe(true)
		})

		test('partial array match', () => {
			const yes = match([1, 2, 3])
				.when([1, 2]).then(true)
				.else(false)
			expect(yes).toBe(true)

			const no = match([1, 2])
				.when([1, 2, 3]).then(true)
				.else(false)
			expect(no).toBe(false)
		})

		test('nested array match', () => {
			const yes = match([[1, 2], [3, 4]])
				.when([[1, 2], [3, 4]]).then(true)
				.else(false)
			expect(yes).toBe(true)

			const no = match([[1, 2], [3, 4]])
				.when([[1, 2], [4, 3]]).then(true)
				.else(false)
			expect(no).toBe(false)
		})
	})

	describe('multiple clauses', () => {
		test.each([
			[42, 'forty-two'],
			[23, 'twenty-three'],
			[69, false],
		])('multiple whens', (value, expected) => {
			expect(
				match(value)
					.when(23).then('twenty-three')
					.when(42).then('forty-two')
					.else(false)
			).toBe(expected)
		})

		test('and', () => {
			expect(
				match(42)
					.when({ min: 23 }).and({ max: 69 }).then(true)
					.else(false)
			).toBe(true)

			const foo = 12 as string | number
			expect(
				match(foo)
					.when(v => typeof v === 'string').then('suck it, Trebek')
					.when<number>(v => typeof v === 'number')
					.and(v => v % 3 === 0).and(v => v % 4 === 0).then(true)
					.else(false)
			).toBe(true)

			expect(
				match(42)
					.when({ min: 23 }).and({ max: 41 }).then(true)
					.else(false)
			).toBe(false)
		})

		test.each([
			['foo', 'FOO'],
			['bar', 'BAR'],
			['baz', 'BAZ'],
			[42, 'forty-two'],
			['42', 'forty-two'],
			['qux', false],
			[50, false],
			[23, 'gte 23 or lte 69'],
			[69, 'gte 23 or lte 69'],
		])('or', (value, expected) => {
			expect(
				match(value)
					.when('foo').or('bar').or('baz').then(v => v.toUpperCase())
					.when(42).or('42').then('forty-two')
					.when({ max: 23 }).or({ min: 69 }).then('gte 23 or lte 69')
					.else(false)
			).toBe(expected)
		})
	})

	describe('placeholders', () => {
		test.each([
			[[1, 2, 3], [_, 2, _], [1, 3]],
			[[1, 2, 3], [1, 2, 3], []],
			[['a', true, 3], [_, _, _], ['a', true, 3]],
			[[['a', 'b', 'c'], [1, 2, 3]], [_, [_, 2, _]], [['a', 'b', 'c'], 1, 3]],
		])('in an array', (value, pattern, placeholders) => {
			const matcher = mock(() => true)
			expect(
				match(value)
					.when(pattern).then(matcher)
					.else(false)
			).toBe(true)
			expect(matcher).toHaveBeenLastCalledWith(value, placeholders)
		})
	})

	test('useful for currying', () => {
		expect(
			match([1, 2, 3])
				.when([_, 2, _]).then((v, placeholders) => placeholders)
				.else(false)
		).toEqual([1, 3])
	})
})
