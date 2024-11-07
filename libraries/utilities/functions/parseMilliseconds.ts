import { Milliseconds } from '../constants/Milliseconds'

export interface TimeComponents {
  days: number,
  hours: number,
  minutes: number,
  ms: number,
  seconds: number,
  sign: number,
  weeks: number,
  years: number,
}

const ZERO: TimeComponents = {
  days: 0,
  hours: 0,
  minutes: 0,
  ms: 0,
  seconds: 0,
  sign: 1,
  weeks: 0,
  years: 0,
}

/**
 * Parse milliseconds into years, weeks, days, hours, minutes, seconds, and milliseconds.
 * @param milliseconds The milliseconds to parse.
 * @returns The parsed time components.
 */
export function parseMilliseconds(milliseconds: number): TimeComponents {
  if (typeof milliseconds !== 'number') return { ...ZERO }
  if (Number.isNaN(milliseconds)) return { ...ZERO }
  if ([Infinity, -Infinity].includes(milliseconds)) return { ...ZERO }

  const sign = milliseconds < 0 ? -1 : 1
  let ms = Math.abs(milliseconds)

  const years = Math.floor(ms / Milliseconds.PerYear)
  ms -= years * Milliseconds.PerYear

  const weeks = Math.floor(ms / Milliseconds.PerWeek)
  ms -= weeks * Milliseconds.PerWeek

  const days = Math.floor(ms / Milliseconds.PerDay)
  ms -= days * Milliseconds.PerDay

  const hours = Math.floor(ms / Milliseconds.PerHour)
  ms -= hours * Milliseconds.PerHour

  const minutes = Math.floor(ms / Milliseconds.PerMinute)
  ms -= minutes * Milliseconds.PerMinute

  const seconds = Math.floor(ms / Milliseconds.PerSecond)
  ms -= seconds * Milliseconds.PerSecond

  return { days, hours, minutes, ms, seconds, sign, weeks, years }
}
