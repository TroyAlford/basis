import { describe, expect, test } from 'bun:test'
import { EMPTY_BASIS_RUNTIME, parseBasisRuntime, serializeBasisRuntime } from './BasisRuntime'

describe('serializeBasisRuntime', () => {
  test('round-trips runtime facts', () => {
    const runtime = { gitSha: 'abc123', serviceName: 'mtg-proxifier', version: '1.2.3' }

    expect(parseBasisRuntime(serializeBasisRuntime(runtime))).toEqual(runtime)
  })

  test('escapes characters that could terminate the embedding script element', () => {
    const serialized = serializeBasisRuntime({
      gitSha: '</script><b>',
      serviceName: 'a&b',
      version: '1<2>3',
    })

    expect(serialized).not.toContain('<')
    expect(serialized).not.toContain('>')
    expect(serialized).not.toContain('&')
    expect(parseBasisRuntime(serialized)).toEqual({
      gitSha: '</script><b>',
      serviceName: 'a&b',
      version: '1<2>3',
    })
  })
})

describe('parseBasisRuntime', () => {
  test('returns empty facts for missing, malformed, or non-object input', () => {
    expect(parseBasisRuntime(null)).toEqual(EMPTY_BASIS_RUNTIME)
    expect(parseBasisRuntime('')).toEqual(EMPTY_BASIS_RUNTIME)
    expect(parseBasisRuntime('not json')).toEqual(EMPTY_BASIS_RUNTIME)
    expect(parseBasisRuntime('[1, 2]')).toEqual(EMPTY_BASIS_RUNTIME)
  })

  test('coerces non-string fields to null', () => {
    expect(parseBasisRuntime('{"gitSha":42,"serviceName":"svc","version":null}')).toEqual({
      gitSha: null,
      serviceName: 'svc',
      version: null,
    })
  })
})
