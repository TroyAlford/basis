/** Cookie attributes supported by the Basis cookie surface. */
export interface CookieOptions {
  /** Domain attribute, e.g. `.example.com`. Omitted for host-only cookies. */
  domain?: string,
  /** Absolute expiration time. */
  expires?: Date,
  /** Prevent JavaScript access. */
  httpOnly?: boolean,
  /** Lifetime in seconds. Use `0` to clear. */
  maxAgeSeconds?: number,
  /** Whether the cookie is partitioned. */
  partitioned?: boolean,
  /** Cookie path. */
  path?: string,
  /** SameSite policy. */
  sameSite?: 'Lax' | 'None' | 'Strict',
  /** Send only over HTTPS. */
  secure?: boolean,
}

/** One response cookie mutation. */
export interface CookieChange {
  /** Cookie name. */
  name: string,
  /** Cookie attributes. */
  options?: CookieOptions,
  /** Cookie value; empty for deletion. */
  value: string,
}

/**
 * Decode a cookie value, preserving malformed percent-encoded input as-is.
 * @param value - Raw cookie value.
 * @returns The decoded value, or the original value when malformed.
 */
const decodeCookieValue = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * A request's typed cookie values plus response mutation helpers.
 *
 * Reading is request-scoped. `set` and `delete` return mutations instead of
 * mutating the request jar, so a context loader can build response cookies
 * without changing the request view.
 * @template Schema - Cookie names and their value types.
 */
export class Cookies<Schema extends Record<string, string> = Record<string, string>> {
  #values: Record<string, string>

  /**
   * Parse a request cookie header.
   * @param header - The request `Cookie` header, or null.
   */
  constructor(header: string | null = null) {
    this.#values = {}
    if (!header) return
    for (const part of header.split(';')) {
      const separator = part.indexOf('=')
      if (separator === -1) continue
      const name = part.slice(0, separator).trim()
      if (!name) continue
      this.#values[name] = decodeCookieValue(part.slice(separator + 1).trim())
    }
  }

  /**
   * Read one cookie value.
   * @param name - Cookie name.
   * @returns The value, or undefined.
   */
  get<Name extends keyof Schema & string>(name: Name): Schema[Name] | undefined {
    return this.#values[name] as Schema[Name] | undefined
  }

  /**
   * Read all cookie values.
   * @returns A frozen copy of the request cookie values.
   */
  values(): Readonly<Record<string, string>> {
    return { ...this.#values }
  }

  /**
   * Build a cookie set mutation.
   * @param name - Cookie name.
   * @param value - Cookie value.
   * @param options - Cookie attributes.
   * @returns The response mutation.
   */
  set<Name extends keyof Schema & string>(
    name: Name,
    value: Schema[Name],
    options?: CookieOptions,
  ): CookieChange {
    return { name, options, value }
  }

  /**
   * Build a cookie deletion mutation.
   * @param name - Cookie name.
   * @param options - Cookie attributes.
   * @returns The response mutation.
   */
  delete<Name extends keyof Schema & string>(
    name: Name,
    options: CookieOptions = {},
  ): CookieChange {
    return {
      name,
      options: { ...options, expires: new Date(0), maxAgeSeconds: 0 },
      value: '',
    }
  }
}

/**
 * Serialize one response cookie.
 * @param change - Cookie mutation.
 * @returns A `Set-Cookie` header value.
 */
export const serializeCookie = (change: CookieChange): string => {
  const { name, options = {}, value } = change
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (options.domain) parts.push(`Domain=${options.domain}`)
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`)
  if (options.path !== undefined) parts.push(`Path=${options.path}`)
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
  if (options.secure) parts.push('Secure')
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.partitioned) parts.push('Partitioned')
  return parts.join('; ')
}
