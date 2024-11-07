const MS_PER_SECOND = 1000
const MS_PER_MINUTE = MS_PER_SECOND * 60
const MS_PER_HOUR = MS_PER_MINUTE * 60
const MS_PER_DAY = MS_PER_HOUR * 24
const MS_PER_WEEK = MS_PER_DAY * 7
const MS_PER_YEAR = MS_PER_DAY * 365.25 // Account for leap years

export const MS = {
  DAY: MS_PER_DAY,
  HOUR: MS_PER_HOUR,
  MINUTE: MS_PER_MINUTE,
  SECOND: MS_PER_SECOND,
  WEEK: MS_PER_WEEK,
  YEAR: MS_PER_YEAR,
}

/**
 * Formats a number of milliseconds into a human-readable string
 * @param ms - The number of milliseconds to format
 * @returns A human-readable string (e.g., "1y5w4d 3:00:04.555" or "123ms")
 */
export function formatMilliseconds(ms: number): string {
  if (ms < MS_PER_SECOND) {
    return `${ms.toFixed(0)}ms`
  }

  if (ms < MS_PER_MINUTE) {
    return `${(ms / MS_PER_SECOND).toFixed(2)}s`
  }

  let remaining = ms
  const years = Math.floor(remaining / MS_PER_YEAR)
  remaining %= MS_PER_YEAR

  const weeks = Math.floor(remaining / MS_PER_WEEK)
  remaining %= MS_PER_WEEK

  const days = Math.floor(remaining / MS_PER_DAY)
  remaining %= MS_PER_DAY

  const hours = Math.floor(remaining / MS_PER_HOUR)
  remaining %= MS_PER_HOUR

  const minutes = Math.floor(remaining / MS_PER_MINUTE)
  remaining %= MS_PER_MINUTE

  const seconds = Math.floor(remaining / MS_PER_SECOND)
  const milliseconds = Math.floor(remaining % MS_PER_SECOND)

  const parts: string[] = []

  // Date part
  if (years > 0) parts.push(`${years}y`)
  if (weeks > 0) parts.push(`${weeks}w`)
  if (days > 0) parts.push(`${days}d`)

  // Time part
  const time = [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0'),
  ].join(':')

  if (parts.length > 0) {
    return `${parts.join('')} ${time}.${milliseconds.toString().padStart(3, '0')}`
  }

  return `${time}.${milliseconds.toString().padStart(3, '0')}`
}
