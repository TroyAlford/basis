import { describe, expect,test } from 'bun:test'
import { clone } from './clone'

describe('clone', () => {
  test('clones objects', () => {
    const o = { a: 1, b: { c: 2 } }
    const c = clone(o)
    expect(c).toEqual(o)
    expect(c).not.toBe(o)
    expect(c.b).not.toBe(o.b)
  })

  test('clones arrays', () => {
    const a = [1, 2, [3, 4]]
    const c = clone(a)
    expect(c).toEqual(a)
    expect(c).not.toBe(a)
    expect(c[2]).not.toBe(a[2])
  })

  test('clones dates', () => {
    const d = new Date()
    const c = clone(d)
    expect(c).toEqual(d)
    expect(c).not.toBe(d)
  })

  test('clones regexps', () => {
    const r = /test/gi
    const c = clone(r)
    expect(c).toEqual(r)
    expect(c).not.toBe(r)
  })
})
