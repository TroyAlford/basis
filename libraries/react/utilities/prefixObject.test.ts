import { describe, expect, test } from 'bun:test'
import { prefixObject } from './prefixObject'

describe('prefixObject', () => {
  test('prefixes all object keys', () => {
    const input = {
      expanded: true,
      label: 'test',
    }

    const result = prefixObject('aria-', input)
    expect(result).toEqual({
      'aria-expanded': true,
      'aria-label': 'test',
    })
  })

  test('returns empty object when input is empty', () => {
    const result = prefixObject('data-', {})
    expect(result).toEqual({})
  })

  test('preserves values of any type', () => {
    const input = {
      array: [1, 2, 3],
      boolean: true,
      null: null,
      number: 42,
      object: { key: 'value' },
      string: 'test',
      undefined: undefined,
    }

    const result = prefixObject('data-', input)
    expect(result).toEqual({
      'data-array': [1, 2, 3],
      'data-boolean': true,
      'data-null': null,
      'data-number': 42,
      'data-object': { key: 'value' },
      'data-string': 'test',
      'data-undefined': undefined,
    })
  })

  test('handles empty prefix', () => {
    const input = {
      test: 'value',
    }

    const result = prefixObject('', input)
    expect(result).toEqual({
      test: 'value',
    })
  })

  test('preserves kebab-case in keys', () => {
    const input = {
      'current-page': false,
      'has-popup': true,
    }

    const result = prefixObject('aria-', input)
    expect(result).toEqual({
      'aria-current-page': false,
      'aria-has-popup': true,
    })
  })

  test('handles keys that already contain the prefix', () => {
    const input = {
      'data-value': 123,
      'value-data': 456,
    }

    const result = prefixObject('data-', input)
    expect(result).toEqual({
      'data-value': 123,
      'data-value-data': 456,
    })
  })

  test('handles different prefix lengths', () => {
    const input = { test: 'value' }

    expect(prefixObject('x-', input)).toEqual({ 'x-test': 'value' })
    expect(prefixObject('xx-', input)).toEqual({ 'xx-test': 'value' })
    expect(prefixObject('xxx-', input)).toEqual({ 'xxx-test': 'value' })
  })

  test('preserves case in keys', () => {
    const input = {
      URL: 'test',
      XMLDoc: 'test',
      simple: 'test',
    }

    const result = prefixObject('data-', input)
    expect(result).toEqual({
      'data-URL': 'test',
      'data-XMLDoc': 'test',
      'data-simple': 'test',
    })
  })
})
