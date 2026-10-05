/**
 * Minimal cookie parsing and serialization for the shared auth cookies.
 *
 * The identity cookie and the OAuth state cookie are both `Path=/`, `HttpOnly`,
 * `Secure`, `SameSite=Lax`; only the name, value, optional `Domain`, and
 * lifetime differ. They are invisible to script, so values stay unencoded —
 * callers must only ever place cookie-safe characters in them.
 */

/** Options shared by the auth cookies. */
export interface CookieOptions {
  /** Parent domain to share with, or omitted for a host-only cookie. */
  readonly domain?: string,
  /** Lifetime in seconds; `0` clears the cookie. */
  readonly maxAgeSeconds: number,
}

/**
 * Read one cookie value from a `Cookie` header.
 * @param header - The `Cookie` header value, or `null`.
 * @param name - The cookie name to read.
 * @returns The cookie value, or `null`.
 */
export function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
  }
  return null
}

/**
 * Build a `Set-Cookie` header value.
 * @param name - Cookie name.
 * @param value - Cookie value, or empty to clear.
 * @param options - Domain and lifetime.
 * @returns The header value.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`, 'Path=/']
  if (options.domain !== undefined && options.domain.length > 0) parts.push(`Domain=${options.domain}`)
  parts.push('HttpOnly', 'Secure', 'SameSite=Lax', `Max-Age=${options.maxAgeSeconds}`)
  return parts.join('; ')
}
