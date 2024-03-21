import { describe, expect, test } from 'bun:test'
import { classNames } from './classNames'

describe('classNames', () => {
	test('handles strings', () => {
		expect(classNames('foo', 'bar')).toBe('foo bar')
		expect(classNames('foo', 'bar', 'baz')).toBe('foo bar baz')
		expect(classNames(' foo bar ', 'foo', 'bar')).toBe('foo bar')
	})

	test('handles sets', () => {
		expect(classNames(new Set(['foo', 'bar']))).toBe('foo bar')
		expect(classNames(new Set(['foo', 'bar']), new Set(['baz']))).toBe('foo bar baz')
		expect(classNames(new Set([' foo bar ', 'foo', 'bar']), new Set(['baz']))).toBe('foo bar baz')
	})

	test('handles maps', () => {
		expect(classNames(new Map([['foo', true], ['bar', false]]))).toBe('foo')
		expect(classNames(new Map([['foo', true], ['bar', false]]), new Map([['baz', true]]))).toBe('foo baz')
		expect(classNames(new Map([[' foo bar ', true], ['bar', true]]), new Map([['baz', true]]))).toBe('foo bar baz')
	})

	test('handles objects', () => {
		expect(classNames({ bar: false, foo: true })).toBe('foo')
		expect(classNames({ bar: false, foo: true }, { baz: true })).toBe('foo baz')
		expect(classNames({ ' foo bar ': true, bar: true, foo: true }, { baz: true }))
			.toBe('foo bar baz')
	})

	test('handles mixed', () => {
		expect(classNames('foo', new Set(['bar']), new Map([['baz', true]]), { qux: true })).toBe('foo bar baz qux')
	})

	test('handles functions', () => {
		expect(classNames('foo', { bar: () => true })).toBe('foo bar')
		expect(classNames('foo', { bar: () => false })).toBe('foo')
	})

	test('deduplicates', () => {
		expect(classNames('foo', 'foo')).toBe('foo')
		expect(classNames('foo', new Set(['foo', 'foo']))).toBe('foo')
		expect(classNames('foo', { foo: true }, new Map([['foo', true]]))).toBe('foo')
	})

	test('ignores invalid entries', () => {
		// @ts-expect-error - testing invalid input
		expect(classNames('foo', null, undefined, 0, NaN, false, '')).toBe('foo')
	})
})