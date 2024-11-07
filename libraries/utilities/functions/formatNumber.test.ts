import { describe, expect, test } from 'bun:test'
import { formatNumber } from './formatNumber'

describe('formatNumber', () => {
  test('handles basic number formatting', () => {
    expect(formatNumber(1234)).toBe('1,234')
    expect(formatNumber(1234.5)).toBe('1,234.5')
    expect(formatNumber(1234.567)).toBe('1,234.567')
    expect(formatNumber(1234.5670)).toBe('1,234.567') // Trims insignificant zeros
  })

  test('handles string inputs', () => {
    expect(formatNumber('1234.56')).toBe('1,234.56')
    expect(formatNumber('-1234.56')).toBe('-1,234.56')
  })

  test('precision option', () => {
    expect(formatNumber(1234.5678, { precision: 2 })).toBe('1,234.57')
    expect(formatNumber(1234, { precision: 2 })).toBe('1,234.00')
    expect(formatNumber(1234.5, { precision: 0 })).toBe('1,235')
    expect(formatNumber(1234.5, { precision: 4 })).toBe('1,234.5000')
  })

  test('sign option', () => {
    // Positive numbers
    expect(formatNumber(1234.56, { sign: 'always' })).toBe('+1,234.56')
    expect(formatNumber(1234.56, { sign: 'negative' })).toBe('1,234.56')
    expect(formatNumber(1234.56, { sign: 'never' })).toBe('1,234.56')

    // Negative numbers
    expect(formatNumber(-1234.56, { sign: 'always' })).toBe('-1,234.56')
    expect(formatNumber(-1234.56, { sign: 'negative' })).toBe('-1,234.56')
    expect(formatNumber(-1234.56, { sign: 'never' })).toBe('1,234.56')

    // Zero
    expect(formatNumber(0, { sign: 'always' })).toBe('0')
    expect(formatNumber(0, { sign: 'negative' })).toBe('0')
    expect(formatNumber(0, { sign: 'never' })).toBe('0')
  })

  test('prefix option', () => {
    expect(formatNumber(1234.56, { prefix: '$' })).toBe('$1,234.56')
    expect(formatNumber(-1234.56, { prefix: '$' })).toBe('$-1,234.56')
    expect(formatNumber(1234.56, { prefix: '£' })).toBe('£1,234.56')
  })

  test('suffix option', () => {
    expect(formatNumber(1234.56, { suffix: ' USD' })).toBe('1,234.56 USD')
    expect(formatNumber(-1234.56, { suffix: ' USD' })).toBe('-1,234.56 USD')
    expect(formatNumber(1234.56, { suffix: '%' })).toBe('1,234.56%')
  })

  test('grouping option', () => {
    expect(formatNumber(1234567.89, { grouping: false })).toBe('1234567.89')
    expect(formatNumber(1234567.89, { grouping: true })).toBe('1,234,567.89')
    expect(formatNumber(-1234567.89, { grouping: false })).toBe('-1234567.89')
  })

  test('locale option', () => {
    expect(formatNumber(1234.56, { locale: 'de-DE' })).toBe('1.234,56')
    expect(formatNumber(1234.56, { locale: 'fr-FR' })).toBe('1 234,56')
    expect(formatNumber(1234.56, {
      locale: 'de-DE',
      prefix: '€',
      suffix: ' EUR',
    })).toBe('€1.234,56 EUR')
  })

  test('handles edge cases', () => {
    expect(formatNumber(NaN)).toBe('NaN')
    expect(formatNumber(Infinity)).toBe('∞')
    expect(formatNumber(-Infinity)).toBe('-∞')
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(-0)).toBe('0')
  })

  test('combines multiple options', () => {
    expect(formatNumber(1234.56, {
      grouping: true,
      locale: 'en-US',
      precision: 2,
      prefix: '$',
      sign: 'always',
      suffix: ' USD',
    })).toBe('$+1,234.56 USD')

    expect(formatNumber(-1234.56, {
      grouping: false,
      locale: 'en-GB',
      precision: 1,
      prefix: '£',
      sign: 'never',
      suffix: ' GBP',
    })).toBe('£1234.6 GBP')
  })
})
