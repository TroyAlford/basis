import { getLocale } from './getLocale'

interface FormatNumberOptions {
  /** Whether to group digits (e.g., 1,000 vs 1000) */
  grouping?: boolean,
  /** The locale to use for formatting (defaults to system locale) */
  locale?: string,
  /** Number of decimal places to show (defaults to 'auto') */
  precision?: number,
  /** Prefix to add (e.g., "$") */
  prefix?: string,
  /** Whether and how to show signs */
  sign?: 'always' | 'negative' | 'never',
  /** Suffix to add (e.g., "USD") */
  suffix?: string,
}

const DEFAULTS: FormatNumberOptions = {
  grouping: true,
  locale: getLocale(),
  prefix: '',
  sign: 'negative',
  suffix: '',
}

/**
 * Format a number using Intl.NumberFormat with a simpler API
 * @param value - The number to format
 * @param options - Formatting options
 * @returns A formatted string
 * @example
 * formatNumber(1234.5678)                           // "1,234.5678"
 * formatNumber(1234.5678, { precision: 2 })         // "1,234.57"
 * formatNumber(1234.5678, { prefix: '$' })          // "$1,234.5678"
 * formatNumber(1234.5678, { suffix: ' USD' })       // "1,234.5678 USD"
 * formatNumber(1234.5678, { sign: 'always' })       // "+1,234.5678"
 * formatNumber(-1234.5678, { sign: 'never' })       // "1,234.5678"
 */
export function formatNumber(
  value: string | number,
  options: FormatNumberOptions = {},
): string {
  // Convert string to number if needed
  const number = typeof value === 'string' ? Number(value) : value

  // Handle invalid numbers
  if (typeof number !== 'number' || Number.isNaN(number)) {
    return 'NaN'
  }

  if (!Number.isFinite(number)) {
    return number > 0 ? '∞' : '-∞'
  }

  const settings = { ...DEFAULTS, ...options }
  const {
    grouping,
    locale,
    precision,
    prefix,
    sign,
    suffix,
  } = settings

  // Determine significant digits if precision is 'auto'
  const digits = precision ?? countSignificantDecimals(number)

  // Build Intl.NumberFormat options
  const intlOptions: Intl.NumberFormatOptions = {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    signDisplay: sign === 'never' ? 'never' : 'auto',
    useGrouping: grouping,
  }

  // Create formatter and format the number
  const formatter = new Intl.NumberFormat(locale, intlOptions)
  let formatted = formatter.format(Math.abs(number))

  // Handle sign separately from Intl.NumberFormat
  if (number < 0 && sign !== 'never') {
    formatted = `-${formatted}`
  } else if (number > 0 && sign === 'always') {
    formatted = `+${formatted}`
  }

  return `${prefix}${formatted}${suffix}`
}

/**
 * Count the number of significant decimal places in a number
 * @param value - The number to count significant decimal places for
 * @returns The number of significant decimal places
 */
function countSignificantDecimals(value: number): number {
  const str = Math.abs(value).toString()
  const decimal = str.indexOf('.')
  if (decimal === -1) return 0

  // Remove trailing zeros after decimal
  const trimmed = str.slice(decimal + 1).replace(/0+$/, '')
  return trimmed.length
}
