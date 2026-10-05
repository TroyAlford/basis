import { describe, expect, test } from 'bun:test'
import type { Scope } from './identity'
import { Identity } from './identity'

/** OAuth client id used throughout. */
const CLIENT_ID = 'client-id'

/** OAuth client secret used throughout. */
const CLIENT_SECRET = 'client-secret'

/** The cookie name the capability owns. */
const COOKIE = 'auth.test'

/** Host used for a plain app origin. */
const APP = 'https://app.example.com/'

/**
 * Build a request, optionally carrying a cookie.
 *
 * The cookie is set after construction because the test DOM strips forbidden
 * request headers (including `Cookie`) in the `Request` constructor.
 * @param url - Request URL.
 * @param cookie - Raw `Cookie` header value, when present.
 * @returns The request.
 */
function requestFor(url: string, cookie?: string): Request {
  const request = new Request(url)
  if (cookie !== undefined) request.headers.set('cookie', cookie)
  return request
}

/**
 * The `name=value` pair from a response's first `Set-Cookie` header.
 * @param headers - Headers a test wrote to.
 * @returns The leading pair, or an empty string.
 */
function cookiePair(headers: Headers): string {
  return (headers.getSetCookie()[0] ?? '').split(';')[0] ?? ''
}

/**
 * Flip the final character of a value, keeping it within the cookie charset.
 * @param value - A base64url value.
 * @returns The tampered value.
 */
function tamper(value: string): string {
  return `${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`
}

/**
 * A default capability under test.
 * @param options - Optional policy overrides.
 * @param options.maxAgeSeconds - Lifetime override, in seconds.
 * @param options.scope - Cookie scope override.
 * @returns The capability.
 */
function identity(options: { maxAgeSeconds?: number, scope?: Scope } = {}): Identity {
  return new Identity({ provider: 'test', public: CLIENT_ID, secret: CLIENT_SECRET, ...options })
}

describe('Identity sign-in', () => {
  test('signs a user in and reads the id back', () => {
    const subject = identity()
    const headers = new Headers()
    subject.set(requestFor(APP), headers, '42')

    const pair = cookiePair(headers)
    expect(pair.startsWith(`${COOKIE}=`)).toBe(true)
    expect(subject.get(requestFor(APP, pair))).toBe('42')
  })

  test('returns null without a cookie', () => {
    expect(identity().get(requestFor(APP))).toBeNull()
  })

  test('returns null for a malformed or unknown cookie', () => {
    const subject = identity()
    expect(subject.get(requestFor(APP, `${COOKIE}=malformed`))).toBeNull()
    expect(subject.get(requestFor(APP, `other_cookie=${encodeURIComponent('v1.abc')}`))).toBeNull()
  })

  test('returns null when the value is tampered with', () => {
    const subject = identity()
    const headers = new Headers()
    subject.set(requestFor(APP), headers, '42')

    const [name, value] = cookiePair(headers).split('=')
    expect(subject.get(requestFor(APP, `${name}=${tamper(value ?? '')}`))).toBeNull()
  })

  test('returns null under a different secret', () => {
    const subject = identity()
    const headers = new Headers()
    subject.set(requestFor(APP), headers, '42')

    const stranger = new Identity({ provider: 'test', public: CLIENT_ID, secret: 'a-different-secret' })
    expect(stranger.get(requestFor(APP, cookiePair(headers)))).toBeNull()
  })

  test('is non-deterministic but still verifies', () => {
    const subject = identity()
    const first = new Headers()
    const second = new Headers()
    subject.set(requestFor(APP), first, '42')
    subject.set(requestFor(APP), second, '42')

    expect(cookiePair(first)).not.toBe(cookiePair(second))
    expect(subject.get(requestFor(APP, cookiePair(first)))).toBe('42')
    expect(subject.get(requestFor(APP, cookiePair(second)))).toBe('42')
  })
})

describe('Identity lifetime', () => {
  test('defaults to thirty days', () => {
    const headers = new Headers()
    identity().set(requestFor(APP), headers, '42')
    expect(headers.getSetCookie()[0]).toContain(`Max-Age=${30 * 24 * 60 * 60}`)
  })

  test('honors the constructor lifetime', () => {
    const headers = new Headers()
    identity({ maxAgeSeconds: 60 }).set(requestFor(APP), headers, '42')
    expect(headers.getSetCookie()[0]).toContain('Max-Age=60')
  })

  test('clears immediately on sign-out', () => {
    const headers = new Headers()
    identity().set(requestFor(APP), headers, null)

    const cookie = headers.getSetCookie()[0] ?? ''
    expect(cookie.startsWith(`${COOKIE}=;`)).toBe(true)
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
  })
})

describe('Identity scope', () => {
  test('is host-only by default', () => {
    const headers = new Headers()
    identity().set(requestFor('https://auth.example.co.uk/'), headers, '42')
    expect(headers.getSetCookie()[0]).not.toContain('Domain=')
  })

  test('shares with the parent under Domain scope', () => {
    const headers = new Headers()
    identity({ scope: Identity.Scope.Domain }).set(requestFor('https://auth.example.co.uk/'), headers, '42')
    expect(headers.getSetCookie()[0]).toContain('Domain=example.co.uk')
  })

  test('drops exactly the current subdomain', () => {
    const headers = new Headers()
    identity({ scope: Identity.Scope.Domain }).set(requestFor('https://cc.troyalford.com/'), headers, '42')
    expect(headers.getSetCookie()[0]).toContain('Domain=troyalford.com')
  })

  test('degrades to host-only for a two-label host', () => {
    const headers = new Headers()
    identity({ scope: Identity.Scope.Domain }).set(requestFor('https://example.com/'), headers, '42')
    expect(headers.getSetCookie()[0]).not.toContain('Domain=')
  })

  test('degrades to host-only for localhost', () => {
    const foo = new Headers()
    const bare = new Headers()
    identity({ scope: Identity.Scope.Domain }).set(requestFor('http://foo.localhost:3000/'), foo, '42')
    identity({ scope: Identity.Scope.Domain }).set(requestFor('http://localhost:3000/'), bare, '42')
    expect(foo.getSetCookie()[0]).not.toContain('Domain=')
    expect(bare.getSetCookie()[0]).not.toContain('Domain=')
  })

  test('clears at the same scope it set', () => {
    const headers = new Headers()
    const subject = identity({ scope: Identity.Scope.Domain })
    subject.set(requestFor('https://auth.example.co.uk/'), headers, '42')
    subject.set(requestFor('https://auth.example.co.uk/'), headers, null)

    const [set, clear] = headers.getSetCookie()
    expect(set).toContain('Domain=example.co.uk')
    expect(clear).toContain('Domain=example.co.uk')
    expect(clear).toContain('Max-Age=0')
  })
})

describe('Identity secret handling', () => {
  test('never exposes the secret on the instance', () => {
    const subject = identity()
    expect(JSON.stringify(subject)).toBe('{}')
    expect(Object.values(subject)).toHaveLength(0)
  })

  test('resolves an op:// credential lazily and fails loudly without a token', () => {
    const previous = Bun.env.OP_SERVICE_ACCOUNT_TOKEN
    Reflect.deleteProperty(Bun.env, 'OP_SERVICE_ACCOUNT_TOKEN')
    try {
      // Constructing does not resolve, so the capability can exist without 1Password.
      const subject = new Identity({ provider: 'test', public: CLIENT_ID, secret: 'op://Vault/item/field' })
      // Using it resolves, and a missing Service Account token fails closed.
      expect(() => subject.set(requestFor(APP), new Headers(), '42')).toThrow()
    } finally {
      if (previous !== undefined) Bun.env.OP_SERVICE_ACCOUNT_TOKEN = previous
    }
  })
})
