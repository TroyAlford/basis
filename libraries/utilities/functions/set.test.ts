import { describe, expect,test } from 'bun:test'
import { set } from './set'

describe('set', () => {
	test('sets a value at the specified path', () => {
		const o = {}
		set('a.b.c', o, 5)
		expect(o).toEqual({ a: { b: { c: 5 } } })
	})

	test('sets numeric keys on pre-existing objects and arrays', () => {
		const o = {}
		set('0', o, 5)
		expect(o).toEqual({ '0': 5 })

		const a = []
		set('0', a, 5)
		expect(a).toEqual([5])
	})

	test('creates objects for missing keys', () => {
		const o = {}
		set('a.b.c', o, 5)
		expect(o).toEqual({ a: { b: { c: 5 } } })

		set('a.n.0', o, 5)
		expect(o).toEqual({ a: { b: { c: 5 }, n: { '0': 5 } } })
	})
})
