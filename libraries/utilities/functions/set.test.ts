import { describe, expect, test } from 'bun:test'
import { set } from './set'

describe('set', () => {
  test('sets a value at the specified path', () => {
    const o = {}
    set(o, 'a.b.c', 5)
    expect(o).toEqual({ a: { b: { c: 5 } } })
  })

  test('sets numeric keys on pre-existing objects and arrays', () => {
    const o = {}
    set(o, '0', 5)
    expect(o).toEqual({ 0: 5 })

    const a: number[] = []
    set(a, '0', 5)
    expect(a).toEqual([5])
  })

  test('creates objects for missing keys', () => {
    const o = {}
    set(o, 'a.b.c', 5)
    expect(o).toEqual({ a: { b: { c: 5 } } })

    set(o, 'a.n.0', 5)
    expect(o).toEqual({ a: { b: { c: 5 }, n: { 0: 5 } } })
  })
})
