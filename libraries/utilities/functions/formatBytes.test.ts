import { expect, test } from 'bun:test'
import { formatBytes } from './formatBytes'

test('formatBytes', () => {
  const cases = [
    [0, '0.00 B'],
    [100, '100.00 B'],
    [1023, '1023.00 B'],
    [1024, '1.00 KB'],
    [1536, '1.50 KB'],
    [1048576, '1.00 MB'],
    [1073741824, '1.00 GB'],
    [1099511627776, '1.00 TB'],
    [1125899906842624, '1.00 PB'],
    // Edge cases
    [1.5 * (1024 ** 5), '1.50 PB'],
    [Number.MAX_SAFE_INTEGER, '8.00 PB'],
  ] as const

  cases.forEach(([input, expected]) => {
    expect(formatBytes(input)).toBe(expected)
  })
})
