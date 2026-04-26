import { describe, expect, test } from 'bun:test'
import { unique } from './unique'

describe('unique', () => {
  test('dedupes primitives (stable)', () => {
    expect(unique([1, 2, 1, 3, 2])).toEqual([1, 2, 3])
    expect(unique(['a', 'b', 'a'])).toEqual(['a', 'b'])
  })

  test('dedupes by selector (stable)', () => {
    const items = [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'a', v: 3 },
    ]
    expect(unique(items, unique.scalars(i => i.id))).toEqual([
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
    ])
  })

  test('dedupes by path', () => {
    const items = [
      { meta: { id: 'a' }, v: 1 },
      { meta: { id: 'b' }, v: 2 },
      { meta: { id: 'a' }, v: 3 },
    ]
    expect(unique(items, unique.by('meta.id'))).toEqual([
      { meta: { id: 'a' }, v: 1 },
      { meta: { id: 'b' }, v: 2 },
    ])
  })

  test('deep de-dupes with unique.deepEquals', () => {
    const items = [
      { a: 1, b: { c: 2 } },
      { a: 1, b: { c: 2 } },
      { a: 1, b: { c: 3 } },
    ]
    expect(unique(items, unique.deepEquals)).toEqual([
      { a: 1, b: { c: 2 } },
      { a: 1, b: { c: 3 } },
    ])
  })
})
