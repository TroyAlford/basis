/**
 * `Set-Cookie` writers for the shared identity cookie.
 *
 * The cookie is host-only by default — `Path=/; HttpOnly; Secure; SameSite=Lax`
 * — so identity stays scoped to one origin. Passing a `domain` adds
 * `Domain=<domain>`, the shared, cross-subdomain form; callers pass the
 * registrable domain from `registrableDomain`. Clearing must use the same
 * domain: with it, the shared cookie is removed; without it, only the host-only
 * cookie is.
 *
 * The value is the encrypted identity from {@link encryptIdentity}. It contains
 * only base64url characters and `.`, so it needs no further encoding in the
 * header.
 */

import { encryptIdentity } from './identity'

/** Thirty days, the default identity lifetime in seconds. */
const DEFAULT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/** Options accepted by {@link setIdentityCookie}. */
export interface SetIdentityCookieOptions {
  /**
   * Registrable domain to share the cookie across subdomains, for example
   * `troyalford.com`. Omitted (or empty) leaves the cookie host-only.
   */
  readonly domain?: string,
  /** Cookie lifetime in seconds. Defaults to 30 days. */
  readonly maxAgeSeconds?: number,
  /** High-entropy provider secret used to encrypt the user id. */
  readonly secret: string,
}

/** Options accepted by {@link clearIdentityCookie}. */
export interface ClearIdentityCookieOptions {
  /**
   * The domain the cookie was set with. Omitted (or empty) clears the
   * host-only cookie.
   */
  readonly domain?: string,
}

/**
 * The attributes shared by setting and clearing, in a stable order.
 */
interface CookieAttributes {
  /** Registrable domain, or `undefined` for a host-only cookie. */
  readonly domain?: string,
  /** Lifetime in seconds; `0` clears. */
  readonly maxAgeSeconds: number,
}

/**
 * Build the shared attribute suffix.
 * @param options - Domain and lifetime.
 * @returns The `; `-joined attributes.
 */
function attributes(options: CookieAttributes): string {
  const parts = ['Path=/']
  if (options.domain !== undefined && options.domain.length > 0) parts.push(`Domain=${options.domain}`)
  parts.push('HttpOnly', 'Secure', 'SameSite=Lax', `Max-Age=${options.maxAgeSeconds}`)
  return parts.join('; ')
}

/**
 * Append the `Set-Cookie` header that establishes the identity cookie.
 *
 * The user id is encrypted with the secret, and the cookie is valid for /
 * readable on every path. The default lifetime is 30 days; pass
 * `maxAgeSeconds` to change it.
 * @param headers - Headers to append to, in place.
 * @param name - Cookie name.
 * @param userId - Authenticated user id to encrypt into the value.
 * @param options - Secret, optional registrable domain, and lifetime.
 */
export function setIdentityCookie(
  headers: Headers,
  name: string,
  userId: string,
  options: SetIdentityCookieOptions,
): void {
  const value = encryptIdentity(userId, options.secret)
  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS
  headers.append('Set-Cookie', `${name}=${value}; ${attributes({ domain: options.domain, maxAgeSeconds })}`)
}

/**
 * Append the `Set-Cookie` header that removes the identity cookie.
 *
 * Pass the same `domain` the cookie was set with to clear the shared cookie;
 * omit it to clear the host-only cookie. The cookie always expires immediately.
 * @param headers - Headers to append to, in place.
 * @param name - Cookie name.
 * @param options - The domain the cookie was set with, when it was shared.
 */
export function clearIdentityCookie(
  headers: Headers,
  name: string,
  options: ClearIdentityCookieOptions = {},
): void {
  headers.append('Set-Cookie', `${name}=; ${attributes({ domain: options.domain, maxAgeSeconds: 0 })}`)
}
