import { describe, expect, test } from 'bun:test'
import { filterByPrefix } from './filterByPrefix'

describe('filterByPrefix', () => {
  test('filters properties by prefix', () => {
    const input = {
      'aria-expanded': true,
      'aria-label': 'test',
      'data-value': 123,
      'other': 'value',
    }

    const result = filterByPrefix('aria-', input)
    expect(result).toEqual({
      expanded: true,
      label: 'test',
    })
  })

  test('returns empty object when no matches found', () => {
    const input = {
      'data-value': 123,
      'other': 'value',
    }

    const result = filterByPrefix('aria-', input)
    expect(result).toEqual({})
  })

  test('handles empty input object', () => {
    const result = filterByPrefix('aria-', {})
    expect(result).toEqual({})
  })

  test('kebab-cases remaining key parts', () => {
    const input = {
      'aria-current-page': true,
      'aria-hasPopup': true,
      'aria-labelledBy': 'test',
    }

    const result = filterByPrefix('aria-', input)
    expect(result).toEqual({
      'current-page': true,
      'has-popup': true,
      'labelled-by': 'test',
    })
  })

  test('preserves values of any type', () => {
    const input = {
      'aria-array': [1, 2, 3],
      'aria-boolean': true,
      'aria-null': null,
      'aria-number': 42,
      'aria-object': { key: 'value' },
      'aria-string': 'test',
      'aria-undefined': undefined,
    }

    const result = filterByPrefix('aria-', input)
    expect(result).toEqual({
      array: [1, 2, 3],
      boolean: true,
      null: null,
      number: 42,
      object: { key: 'value' },
      string: 'test',
      undefined: undefined,
    })
  })

  test('handles different prefix lengths', () => {
    const input = {
      'x-test': 1,
      'xx-test': 2,
      'xxx-test': 3,
    }

    expect(filterByPrefix('x-', input)).toEqual({ test: 1 })
    expect(filterByPrefix('xx-', input)).toEqual({ test: 2 })
    expect(filterByPrefix('xxx-', input)).toEqual({ test: 3 })
  })

  test('handles prefix that appears multiple times in key', () => {
    const input = {
      'data-data-value': 123,
      'data-value-data': 456,
    }

    const result = filterByPrefix('data-', input)
    expect(result).toEqual({
      'data-value': 123,
      'value-data': 456,
    })
  })
})
