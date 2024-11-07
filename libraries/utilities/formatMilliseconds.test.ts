import { expect, test } from 'bun:test'
import { formatMilliseconds, MS } from './formatMilliseconds'

test('formatMilliseconds', () => {
  const cases = [
    [0, '0ms'],
    [500, '500ms'],
    [999, '999ms'],
    [MS.SECOND, '1.00s'],
    [1.5 * MS.SECOND, '1.50s'],
    [MS.MINUTE, '00:01:00.000'],
    [MS.HOUR, '01:00:00.000'],
    [MS.HOUR + MS.SECOND, '01:00:01.000'],
    [MS.DAY, '1d 00:00:00.000'],
    [MS.DAY + MS.HOUR + MS.SECOND, '1d 01:00:01.000'],
    [MS.YEAR, '1y 00:00:00.000'],
    // Complex case
    [
      (2_024 * MS.YEAR)
      + (5 * MS.WEEK)
      + (4 * MS.DAY)
      + (3 * MS.HOUR)
      + (2 * MS.MINUTE)
      + (1 * MS.SECOND)
      + 500, // 500ms
      '2024y5w4d 03:02:01.500',
    ],
  ] as const

  cases.forEach(([input, expected]) => {
    expect(formatMilliseconds(input)).toBe(expected)
  })
})
