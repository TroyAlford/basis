import { Milliseconds } from './constants/Milliseconds'
import { parseMilliseconds } from './functions/parseMilliseconds'

/**
 * Formats a number of milliseconds into a human-readable string
 * @param ms - The number of milliseconds to format
 * @returns A human-readable string (e.g., "1y5w4d 3:00:04.555" or "123ms")
 */
export function formatMilliseconds(ms: number): string {
  // Handle small values specially for better readability
  if (ms < Milliseconds.PerSecond) {
    return `${ms.toFixed(0)}ms`
  }

  if (ms < Milliseconds.PerMinute) {
    return `${(ms / Milliseconds.PerSecond).toFixed(2)}s`
  }

  const {
    days,
    hours,
    minutes,
    ms: milliseconds,
    seconds,
    sign,
    weeks,
    years,
  } = parseMilliseconds(ms)

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

  const formattedTime = `${time}.${milliseconds.toString().padStart(3, '0')}`

  const formatted = parts.length > 0
    ? `${parts.join('')} ${formattedTime}`
    : formattedTime

  return sign === -1
    ? `-${formatted}`
    : formatted
}
