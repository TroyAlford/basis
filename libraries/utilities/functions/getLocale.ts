const DEFAULT_LOCALE = 'en-US'

/**
 * Get the user's preferred locale
 * @returns The user's locale string (e.g., "en-US")
 */
export function getLocale(): string {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE

  return (
    navigator.languages?.[0]
    ?? navigator.language
    ?? DEFAULT_LOCALE
  )
}
