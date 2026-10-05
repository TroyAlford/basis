import { describe, expect, test } from 'bun:test'
import { clearIdentityCookie, setIdentityCookie } from './cookie'
import { readIdentity } from './identity'

/** A stand-in provider secret; the real one is a provider/client secret. */
const SECRET = 'provider-secret-for-tests'

/** Cookie name a caller would use for the shared identity cookie. */
const NAME = 'ad_identity'

/** Default lifetime, in seconds, as written to `Max-Age`. */
const THIRTY_DAYS = 2_592_000

/**
 * The single `Set-Cookie` value a response carries.
 * @param headers - Headers a helper wrote to.
 * @returns The header value, or an empty string.
 */
function onlyCookie(headers: Headers): string {
  return headers.getSetCookie()[0] ?? ''
}

/**
 * The cookie value from a `Set-Cookie` header, before its attributes.
 * @param header - A `Set-Cookie` header value.
 * @returns The value portion.
 */
function cookieValue(header: string): string {
  return header.split(';')[0]?.slice(`${NAME}=`.length) ?? ''
}

describe('setIdentityCookie', () => {
  test('writes the default host-only attributes and a 30-day lifetime', () => {
    const headers = new Headers()
    setIdentityCookie(headers, NAME, '1', { secret: SECRET })

    const cookie = onlyCookie(headers)
    expect(cookie.startsWith(`${NAME}=`)).toBe(true)
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain(`Max-Age=${THIRTY_DAYS}`)
    // No `Domain` attribute: host-only, scoped to a single origin.
    expect(cookie).not.toContain('Domain=')
  })

  test('writes a value the reader accepts', () => {
    const headers = new Headers()
    setIdentityCookie(headers, NAME, '42', { secret: SECRET })
    expect(readIdentity(cookieValue(onlyCookie(headers)), SECRET)).toBe('42')
  })

  test('adds a Domain attribute when a registrable domain is given', () => {
    const headers = new Headers()
    setIdentityCookie(headers, NAME, '1', { domain: 'troyalford.com', secret: SECRET })
    expect(onlyCookie(headers)).toContain('Domain=troyalford.com')
  })

  test('treats an empty domain as host-only', () => {
    const headers = new Headers()
    setIdentityCookie(headers, NAME, '1', { domain: '', secret: SECRET })
    expect(onlyCookie(headers)).not.toContain('Domain=')
  })

  test('honors a maxAgeSeconds override', () => {
    const headers = new Headers()
    setIdentityCookie(headers, NAME, '1', { maxAgeSeconds: 60, secret: SECRET })
    expect(onlyCookie(headers)).toContain('Max-Age=60')
  })

  test('appends rather than replacing earlier cookies', () => {
    const headers = new Headers()
    setIdentityCookie(headers, NAME, '1', { secret: SECRET })
    setIdentityCookie(headers, NAME, '2', { secret: SECRET })
    expect(headers.getSetCookie()).toHaveLength(2)
  })
})

describe('clearIdentityCookie', () => {
  test('expires the host-only cookie immediately', () => {
    const headers = new Headers()
    clearIdentityCookie(headers, NAME)

    const cookie = onlyCookie(headers)
    expect(cookie.startsWith(`${NAME}=;`)).toBe(true)
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).not.toContain('Domain=')
  })

  test('clears the shared cookie when given the same domain', () => {
    const headers = new Headers()
    clearIdentityCookie(headers, NAME, { domain: 'troyalford.com' })
    expect(onlyCookie(headers)).toContain('Domain=troyalford.com')
    expect(onlyCookie(headers)).toContain('Max-Age=0')
  })

  test('set and clear use the same domain scope', () => {
    const headers = new Headers()
    setIdentityCookie(headers, NAME, '1', { domain: 'troyalford.com', secret: SECRET })
    clearIdentityCookie(headers, NAME, { domain: 'troyalford.com' })

    const [set, clear] = headers.getSetCookie()
    expect(set).toContain('Domain=troyalford.com')
    expect(clear).toContain('Domain=troyalford.com')
  })
})
