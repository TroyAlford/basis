import { describe, expect, test } from 'bun:test'
import { get } from './get'

describe('get', () => {
  test('gets a value from an object', () => {
    expect(get({ a: 1, b: 2 }, 'a')).toBe(1)
    expect(get({ a: 1, b: 2 }, 'b')).toBe(2)
  })

  test('gets a value from a nested object', () => {
    expect(get({ a: { b: 1 } }, 'a.b')).toBe(1)
    // @ts-expect-error - inferred typing is correctly erroring
    expect(get({ a: { c: 1 } }, 'a.b')).toBe(undefined)
  })

  test('gets a value from an array', () => {
    expect(get([1, 2], '0')).toBe(1)
    expect(get([1, 2], '1')).toBe(2)
  })

  test('gets a value from a nested array', () => {
    expect(get([[1], [2]], '0.0')).toBe(1)
    expect(get([[1], [2]], '1.0')).toBe(2)
  })

  test('gets a value from a mixed object', () => {
    expect(get({ a: [1, 2] }, 'a.0')).toBe(1)
    expect(get({ a: [1, 2] }, 'a.1')).toBe(2)
  })
})
