import { expect, test } from 'bun:test'
import { Milliseconds } from '../constants/Milliseconds'
import { formatMilliseconds } from './formatMilliseconds'

test('formatMilliseconds', () => {
  const cases = [
    [0, '0ms'],
    [500, '500ms'],
    [999, '999ms'],
    [Milliseconds.PerSecond, '1.00s'],
    [1.5 * Milliseconds.PerSecond, '1.50s'],
    [Milliseconds.PerMinute, '00:01:00.000'],
    [Milliseconds.PerHour, '01:00:00.000'],
    [Milliseconds.PerHour + Milliseconds.PerSecond, '01:00:01.000'],
    [Milliseconds.PerDay, '1d 00:00:00.000'],
    [Milliseconds.PerDay + Milliseconds.PerHour + Milliseconds.PerSecond, '1d 01:00:01.000'],
    [Milliseconds.PerYear, '1y 00:00:00.000'],
    // Complex case
    [
      (2_024 * Milliseconds.PerYear)
      + (5 * Milliseconds.PerWeek)
      + (4 * Milliseconds.PerDay)
      + (3 * Milliseconds.PerHour)
      + (2 * Milliseconds.PerMinute)
      + (1 * Milliseconds.PerSecond)
      + 500, // 500ms
      '2024y5w4d 03:02:01.500',
    ],
  ] as const

  cases.forEach(([input, expected]) => {
    expect(formatMilliseconds(input)).toBe(expected)
  })
})
