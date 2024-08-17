import { describe, expect, test } from 'bun:test'
import { hash } from './hash'

describe('hash', () => {
  test.each([
    [1, 'N'],
    [2, 'O'],
    [3, 'P'],
    ['x', 'yt9'],
    ['y', '3u9'],
    ['z', 'yu9'],
    ['hello', 'YTS9d1'],
    [[1, 2, 3, 'a', 'b', 'c'], 'KXibe1'],
    [true, '8tYe'],
    [false, 'DcPz6'],
    [{ a: 1, b: 2 }, 'alwQn1'],
  ])('handles %p', (value, expected) => {
    expect(hash(value)).toEqual(expected)

    expect(hash(value, { length: 10 }))
      .toEqual(expected.padEnd(10, '-').substring(0, 10))

    expect(hash(value, { length: 4 }))
      .toEqual(expected.padEnd(4, '-').substring(0, 4))

    // accounts for prefix in length
    expect(hash(value, { prefix: '!!' })).toEqual(`!!${expected}`)
    expect(hash(value, { length: 4, prefix: '!!' }))
      .toEqual(`!!${expected}`.padEnd(4, '-').substring(0, 4))

    // pads with custom character
    expect(hash(value, { length: 10, padWith: '!' }))
      .toEqual(expected.padEnd(10, '!').substring(0, 10))

    // pads with multi-character filler
    expect(hash(value, { length: 10, padWith: 'pad' }))
      .toEqual(expected.padEnd(10, 'pad').substring(0, 10))
  })
})
