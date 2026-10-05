/**
 * Public surface of `basis/auth`.
 *
 * One capability — the shared cross-subdomain identity cookie — and only the
 * types a caller must name to use it:
 *
 * - `encryptIdentity` / `readIdentity` — the cookie value: a user id sealed
 *   with a provider secret (AES-256-GCM, versioned, base64url).
 * - `setIdentityCookie` / `clearIdentityCookie` — the `Set-Cookie` writers,
 *   host-only by default and shared across subdomains when given a domain
 *   (`SetIdentityCookieOptions`, `ClearIdentityCookieOptions`).
 * - `registrableDomain` — derive that domain from a request `Host`.
 *
 * Everything else is internal implementation and is deliberately not
 * re-exported: the key derivation and blob layout, the attribute builder, and
 * the hostname parser. The package is transport-shaped, not policy-shaped — it
 * neither reads a request's cookie nor decides who is allowed in; callers do.
 */

export { clearIdentityCookie, setIdentityCookie } from './cookie'
export type { ClearIdentityCookieOptions, SetIdentityCookieOptions } from './cookie'
export { registrableDomain } from './domain'
export { encryptIdentity, readIdentity } from './identity'
