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

  test('handles keys with dots as literal keys', () => {
    // @ts-expect-error - inferred typing is correctly erroring
    expect(get({ 'foo.bar': 42 }, 'foo.bar')).toBe(42)
    // @ts-expect-error - inferred typing is correctly erroring
    expect(get({ 'foo.bar.baz': 1 }, 'foo.bar.baz')).toBe(1)
  })

  test('handles nested objects with dotted keys', () => {
    // @ts-expect-error - inferred typing is correctly erroring
    expect(get({ 'foo.bar': { baz: 1 } }, 'foo.bar.baz')).toBe(1)
    // @ts-expect-error - inferred typing is correctly erroring
    expect(get({ foo: { 'bar.baz': 1 } }, 'foo.bar.baz')).toBe(1)
  })

  test('prioritizes literal keys over dot notation', () => {
    const obj = { 'a': { b: 24 }, 'a.b': 42 }
    expect(get(obj, 'a.b')).toBe(42) // Should get the literal key, not a.b
  })

  test('falls back to dot notation when literal key does not exist', () => {
    const obj = { a: { b: 24 } }
    expect(get(obj, 'a.b')).toBe(24) // Should traverse a.b
  })

  test('handles mixed scenarios', () => {
    const obj = {
      'a.b.c': 3,
      'x': { 'y.z': 2 },
      'x.y': { z: 1 },
    }
    // @ts-expect-error - inferred typing is correctly erroring
    expect(get(obj, 'x.y.z')).toBe(1) // Should find 'x.y' literal key first, then z
    // @ts-expect-error - inferred typing is correctly erroring
    expect(get(obj, 'a.b.c')).toBe(3) // Should find 'a.b.c' literal key
  })
})
