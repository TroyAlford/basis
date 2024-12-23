import { describe, expect, test } from 'bun:test'
import { merge } from './merge'

describe('merge', () => {
  test('merges nested objects recursively', () => {
    const result = merge<Record<string, unknown>>(
      {
        foo: {
          bar: 'bar',
          baz: 'baz',
          nested: {
            a: 1,
            b: 2,
          },
        },
      },
      {
        foo: {
          bar: 'qux',
          nested: {
            b: 3,
            c: 4,
          },
          qux: 'quux',
        },
      },
    )
    expect(result).toStrictEqual({
      foo: {
        bar: 'qux',
        baz: 'baz',
        nested: {
          a: 1,
          b: 3,
          c: 4,
        },
        qux: 'quux',
      },
    })
  })

  test('replaces values when types differ', () => {
    expect(merge<Record<string, unknown>>(
      { foo: { bar: 'bar' } },
      { foo: 'bar' },
    )).toStrictEqual({ foo: 'bar' })

    expect(merge<Record<string, unknown>>(
      { foo: 'bar' },
      { foo: { bar: 'bar' } },
    )).toStrictEqual({ foo: { bar: 'bar' } })

    expect(merge<Record<string, unknown>>(
      { foo: [1, 2] },
      { foo: { bar: 'bar' } },
    )).toStrictEqual({ foo: { bar: 'bar' } })
  })

  test('handles empty objects', () => {
    expect(merge(null)).toStrictEqual({})
    expect(merge({})).toStrictEqual({})
    expect(merge({}, {})).toStrictEqual({})
  })

  test('handles null and undefined values', () => {
    expect(merge<Record<string, unknown>>(
      { foo: null },
      { foo: { bar: 'bar' } },
    )).toStrictEqual({ foo: { bar: 'bar' } })

    expect(merge<Record<string, unknown>>(
      { foo: { bar: 'bar' } },
      { foo: null },
    )).toStrictEqual({ foo: null })

    expect(merge<Record<string, unknown>>(
      { foo: undefined },
      { foo: { bar: 'bar' } },
    )).toStrictEqual({ foo: { bar: 'bar' } })

    expect(merge<Record<string, unknown>>(
      { foo: { bar: 'bar' } },
      { foo: undefined },
    )).toStrictEqual({ foo: undefined })
  })

  test('preserves arrays', () => {
    expect(merge<Record<string, unknown>>(
      { bar: { baz: [3, 4] }, foo: [1, 2] },
      { bar: { baz: [7, 8] }, foo: [5, 6] },
    )).toStrictEqual({
      bar: { baz: [7, 8] },
      foo: [5, 6],
    })
  })

  test('handles complex nested structures', () => {
    const result = merge<Record<string, unknown>>(
      {
        a: {
          b: {
            c: 1,
            d: [1, 2],
            e: { f: 'f' },
          },
        },
      },
      {
        a: {
          b: {
            c: 2,
            d: [3, 4],
            e: { g: 'g' },
          },
        },
      },
    )
    expect(result).toStrictEqual({
      a: {
        b: {
          c: 2,
          d: [3, 4],
          e: { f: 'f', g: 'g' },
        },
      },
    })
  })
})
