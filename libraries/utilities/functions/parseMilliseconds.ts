const SECOND = 1000
const MINUTE = SECOND * 60
const HOUR = MINUTE * 60
const DAY = HOUR * 24
const WEEK = DAY * 7
const YEAR = DAY * 365.25

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

  const years = Math.floor(ms / YEAR)
  ms -= years * YEAR

  const weeks = Math.floor(ms / WEEK)
  ms -= weeks * WEEK

  const days = Math.floor(ms / DAY)
  ms -= days * DAY

  const hours = Math.floor(ms / HOUR)
  ms -= hours * HOUR

  const minutes = Math.floor(ms / MINUTE)
  ms -= minutes * MINUTE

  const seconds = Math.floor(ms / SECOND)
  ms -= seconds * SECOND

  return { days, hours, minutes, ms, seconds, sign, weeks, years }
}
