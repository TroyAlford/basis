import { describe, expect, test } from 'bun:test'
import { Identity } from '../../oauth'
import type { IdentityCredentials } from '../../oauth/identity'
import type { OAuthOptions } from './OAuth'
import { OAuth } from './OAuth'
import { Server } from './Server'

/** Client credentials the session capability holds. */
const CREDENTIALS = { public: 'client-id', secret: 'client-secret' }

/** Public origin the flow answers on. */
const ORIGIN = 'https://app.example.com'

/**
 * Capture `Set-Cookie` values while a response is built.
 *
 * The test DOM's `Response` strips `Set-Cookie` (a forbidden response header),
 * so the header is observed at the `Headers.append` call instead.
 * @returns The capture buffer and a restore function.
 */
function captureSetCookie(): { cookies: string[], restore: () => void } {
  const cookies: string[] = []
  const append = Headers.prototype.append
  Headers.prototype.append = function (this: Headers, name: string, value: string): void {
    if (name.toLowerCase() === 'set-cookie') cookies.push(value)
    append.call(this, name, value)
  }
  return { cookies, restore: (): void => { Headers.prototype.append = append } }
}

/**
 * Build a request, optionally carrying a cookie.
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
 * The value from a `Set-Cookie` header, without its attributes.
 * @param header - A `Set-Cookie` header value.
 * @returns The cookie value.
 */
function cookieValue(header: string): string {
  const pair = header.split(';')[0] ?? ''
  return pair.slice(pair.indexOf('=') + 1)
}

/**
 * A flow with scripted provider seams.
 * @param overrides - Provider or policy overrides.
 * @returns The flow.
 */
function flow(overrides: Partial<OAuthOptions> = {}): OAuth {
  return new OAuth({
    authorize: (state, credentials) => `https://provider.test/authorize?state=${state}&client_id=${credentials.public}`,
    exchange: async () => 'access-token',
    identity: async () => 'user-42',
    session: new Identity(CREDENTIALS),
    ...overrides,
  })
}

/**
 * Run one login round trip and return the captured cookies.
 * @param subject - The flow to drive.
 * @returns The captured `Set-Cookie` values.
 */
function login(subject: OAuth): string[] {
  const capture = captureSetCookie()
  try {
    subject.login()
    return [...capture.cookies]
  } finally {
    capture.restore()
  }
}

describe('OAuth login', () => {
  test('redirects to the provider with a state and sets a state cookie', () => {
    const capture = captureSetCookie()
    try {
      const response = flow().login()
      expect(response.status).toBe(302)

      const location = new URL(response.headers.get('location') ?? '')
      expect(location.searchParams.get('state')).not.toBeNull()
      expect(location.searchParams.get('client_id')).toBe('client-id')

      const stateCookie = capture.cookies[0] ?? ''
      expect(stateCookie.startsWith('basis_oauth_state=')).toBe(true)
      expect(stateCookie).toContain('HttpOnly')
      expect(stateCookie).toContain('Secure')
      expect(stateCookie).toContain('SameSite=Lax')
      expect(stateCookie).toContain('Max-Age=600')
    } finally {
      capture.restore()
    }
  })

  test('hands the resolved client credentials to the provider seams', () => {
    let seen: IdentityCredentials | null = null
    const subject = flow({
      authorize: (_state, credentials) => {
        seen = credentials
        return 'https://provider.test/authorize'
      },
    })
    subject.login()
    expect(seen).toEqual({ public: 'client-id', secret: 'client-secret' })
  })
})

describe('OAuth callback', () => {
  test('signs the user in and clears the state cookie', async () => {
    const capture = captureSetCookie()
    try {
      const subject = flow()
      const stateCookie = login(subject).find(cookie => cookie.startsWith('basis_oauth_state=')) ?? ''
      const state = cookieValue(stateCookie)

      const request = requestFor(
        `${ORIGIN}/api/oauth/callback?code=abc&state=${state}`,
        stateCookie.split(';')[0],
      )
      const response = await subject.callback(request)

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/')
      expect(capture.cookies.some(cookie => cookie.startsWith('basis_oauth_state=;'))).toBe(true)

      const identityCookie = capture.cookies.find(cookie => cookie.startsWith('basis_identity=')) ?? ''
      expect(identityCookie).not.toBe('')
      expect(subject.session(requestFor(ORIGIN, identityCookie.split(';')[0]))).toBe('user-42')
    } finally {
      capture.restore()
    }
  })

  test('rejects a missing or mismatched state without calling the provider', async () => {
    let exchanged = false
    const subject = flow({
      exchange: async () => {
        exchanged = true
        return 'access-token'
      },
    })

    const noState = await subject.callback(requestFor(`${ORIGIN}/api/oauth/callback?code=abc`))
    const mismatched = await subject.callback(
      requestFor(`${ORIGIN}/api/oauth/callback?code=abc&state=wrong`, 'basis_oauth_state=expected'),
    )

    expect(noState.status).toBe(400)
    expect(mismatched.status).toBe(400)
    expect(exchanged).toBe(false)
  })

  test('fails closed when the exchange returns nothing', async () => {
    const capture = captureSetCookie()
    try {
      const subject = flow({ exchange: async () => null })
      const stateCookie = login(subject).find(cookie => cookie.startsWith('basis_oauth_state=')) ?? ''

      const response = await subject.callback(requestFor(
        `${ORIGIN}/api/oauth/callback?code=abc&state=${cookieValue(stateCookie)}`,
        stateCookie.split(';')[0],
      ))

      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'exchange_failed' })
      expect(capture.cookies.some(cookie => cookie.startsWith('basis_oauth_state=;'))).toBe(true)
    } finally {
      capture.restore()
    }
  })

  test('fails closed when the profile cannot be resolved', async () => {
    const subject = flow({ identity: async () => null })
    const stateCookie = login(subject).find(cookie => cookie.startsWith('basis_oauth_state=')) ?? ''

    const response = await subject.callback(requestFor(
      `${ORIGIN}/api/oauth/callback?code=abc&state=${cookieValue(stateCookie)}`,
      stateCookie.split(';')[0],
    ))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'identity_failed' })
  })
})

describe('OAuth logout', () => {
  test('clears the identity cookie immediately', () => {
    const capture = captureSetCookie()
    try {
      const response = flow().logout(requestFor(`${ORIGIN}/api/oauth/logout`))
      expect(response.status).toBe(302)

      const identityCookie = capture.cookies.find(cookie => cookie.startsWith('basis_identity=')) ?? ''
      expect(identityCookie).toContain('Max-Age=0')
    } finally {
      capture.restore()
    }
  })
})

describe('Server.oauth', () => {
  test('mounts the login, callback, and logout routes', async () => {
    const server = new Server().oauth({
      authorize: state => `https://provider.test/authorize?state=${state}`,
      exchange: async () => 'access-token',
      identity: async () => 'user-42',
      session: new Identity(CREDENTIALS),
    })

    const loginResponse = await server.handle(requestFor(`${ORIGIN}/api/oauth/login`))
    expect(loginResponse?.status).toBe(302)
    expect(loginResponse?.headers.get('location')).toContain('provider.test')
  })
})
