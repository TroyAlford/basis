import { describe, expect, test } from 'bun:test'
import { Identity } from '../../oauth'
import type { IdentityCredentials } from '../../oauth/identity'
import { HttpVerb } from '../../utilities'
import type { OAuthOptions } from './OAuth'
import { OAuth } from './OAuth'
import { Server } from './Server'

/** Client credentials the session capability holds. */
const CREDENTIALS = { provider: 'test', public: 'client-id', secret: 'client-secret' }

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
    returnToDomains: ['example.com'],
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

  test('shares the one-shot cookies on the configured domain', () => {
    const capture = captureSetCookie()
    try {
      const subject = flow({ cookieDomain: '.example.com' })
      subject.login(requestFor(
        `${ORIGIN}/api/oauth/login?returnTo=${encodeURIComponent('/done')}`,
      ))
      const cookies = capture.cookies.join('\n')
      expect(cookies).toContain('basis_oauth_state=')
      expect(cookies).toContain('Domain=.example.com')
      expect(cookies).toContain('basis_oauth_return_to=')
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

  test('stores a validated return target and gives the request to authorize', () => {
    let seen: Request | undefined
    const subject = flow({
      authorize: (state, _credentials, request) => {
        seen = request
        return `https://provider.test/authorize?state=${state}`
      },
    })

    const capture = captureSetCookie()
    try {
      const returnTo = encodeURIComponent('/some/random/path?tab=one')
      const request = requestFor(`${ORIGIN}/api/oauth/login?returnTo=${returnTo}`)
      subject.login(request)

      const returnToCookie = capture.cookies.find(cookie => cookie.startsWith('basis_oauth_return_to=')) ?? ''
      expect(decodeURIComponent(cookieValue(returnToCookie))).toBe('/some/random/path?tab=one')
      expect(seen).toBe(request)
    } finally {
      capture.restore()
    }
  })

  test('stores an absolute target on a sibling application host', () => {
    const capture = captureSetCookie()
    try {
      const returnTo = 'https://campaign.example.com/some/random/path?tab=one'
      flow().login(requestFor(`${ORIGIN}/api/oauth/login?returnTo=${encodeURIComponent(returnTo)}`))

      const returnCookie = capture.cookies.find(cookie => cookie.startsWith('basis_oauth_return_to=')) ?? ''
      expect(decodeURIComponent(cookieValue(returnCookie))).toBe(returnTo)
    } finally {
      capture.restore()
    }
  })

  test('uses the forwarded public origin for absolute return targets', () => {
    const capture = captureSetCookie()
    try {
      const returnTo = 'https://www.example.com/done'
      const request = {
        headers: new Headers({
          'x-forwarded-host': 'api.example.com',
          'x-forwarded-proto': 'https',
        }),
        url: `http://127.0.0.1:4321/api/oauth/login?returnTo=${encodeURIComponent(returnTo)}`,
      } as Request
      flow().login(request)

      const returnCookie = capture.cookies.find(cookie => cookie.startsWith('basis_oauth_return_to=')) ?? ''
      expect(decodeURIComponent(cookieValue(returnCookie))).toBe(returnTo)
    } finally {
      capture.restore()
    }
  })

  test('does not store an external or protocol-relative return target', () => {
    for (const target of [
      'https://evil.test/steal',
      '//campaign.example.com/steal',
      '/\\evil.test/steal',
    ]) {
      const capture = captureSetCookie()
      try {
        flow().login(requestFor(`${ORIGIN}/api/oauth/login?returnTo=${encodeURIComponent(target)}`))
        expect(capture.cookies.some(cookie => cookie.startsWith('basis_oauth_return_to='))).toBe(false)
      } finally {
        capture.restore()
      }
    }
  })

  test('requires an explicit trusted boundary for multi-label public suffixes', () => {
    const requestUrl = 'https://www.example.co.uk/api/oauth/login'
    const candidate = 'https://campaign.example.co.uk/dashboard'
    const untrusted = captureSetCookie()
    try {
      flow({ returnToDomains: [] }).login(
        requestFor(`${requestUrl}?returnTo=${encodeURIComponent(candidate)}`),
      )
      expect(untrusted.cookies.some(cookie => cookie.startsWith('basis_oauth_return_to='))).toBe(false)
    } finally {
      untrusted.restore()
    }

    const trusted = captureSetCookie()
    try {
      flow({ returnToDomains: ['example.co.uk'] }).login(
        requestFor(`${requestUrl}?returnTo=${encodeURIComponent(candidate)}`),
      )
      const returnCookie = trusted.cookies.find(cookie => cookie.startsWith('basis_oauth_return_to=')) ?? ''
      expect(decodeURIComponent(cookieValue(returnCookie))).toBe(candidate)
    } finally {
      trusted.restore()
    }
  })

  test('does not infer shared-hosting suffixes without an explicit boundary', () => {
    const capture = captureSetCookie()
    try {
      flow({ returnToDomains: [] }).login(requestFor(
        `https://app.github.io/api/oauth/login?returnTo=${
          encodeURIComponent('https://attacker.github.io/steal')
        }`,
      ))
      expect(capture.cookies.some(cookie => cookie.startsWith('basis_oauth_return_to='))).toBe(false)
    } finally {
      capture.restore()
    }
  })

  test('rejects matching hosts with a different protocol or port', () => {
    for (const target of [
      'http://campaign.example.com/done',
      'https://campaign.example.com:8443/done',
    ]) {
      const capture = captureSetCookie()
      try {
        flow().login(requestFor(`${ORIGIN}/api/oauth/login?returnTo=${encodeURIComponent(target)}`))
        expect(capture.cookies.some(cookie => cookie.startsWith('basis_oauth_return_to='))).toBe(false)
      } finally {
        capture.restore()
      }
    }
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

      const identityCookie = capture.cookies.find(cookie => cookie.startsWith('auth.test=')) ?? ''
      expect(identityCookie).not.toBe('')
      expect(subject.session(requestFor(ORIGIN, identityCookie.split(';')[0]))).toBe('user-42')
    } finally {
      capture.restore()
    }
  })

  test('returns to the stored target and clears it', async () => {
    const capture = captureSetCookie()
    try {
      const subject = flow()
      const loginRequest = requestFor(
        `${ORIGIN}/api/oauth/login?returnTo=${encodeURIComponent('/some/random/path?tab=one')}`,
      )
      subject.login(loginRequest)
      const stateCookie = capture.cookies.find(cookie => cookie.startsWith('basis_oauth_state=')) ?? ''
      const returnToCookie = capture.cookies.find(cookie => cookie.startsWith('basis_oauth_return_to=')) ?? ''

      const response = await subject.callback(requestFor(
        `${ORIGIN}/api/oauth/callback?code=abc&state=${cookieValue(stateCookie)}`,
        `${stateCookie.split(';')[0]}; ${returnToCookie.split(';')[0]}`,
      ))

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/some/random/path?tab=one')
      expect(capture.cookies.some(cookie => cookie.startsWith('basis_oauth_return_to=;'))).toBe(true)
    } finally {
      capture.restore()
    }
  })

  test('returns to an absolute target on a sibling application host', async () => {
    const capture = captureSetCookie()
    try {
      const returnTo = 'https://campaign.example.com/some/random/path?tab=one'
      const subject = flow()
      subject.login(requestFor(
        `${ORIGIN}/api/oauth/login?returnTo=${encodeURIComponent(returnTo)}`,
      ))
      const stateCookie = capture.cookies.find(cookie => cookie.startsWith('basis_oauth_state=')) ?? ''
      const returnToCookie = capture.cookies.find(cookie => cookie.startsWith('basis_oauth_return_to=')) ?? ''

      const response = await subject.callback(requestFor(
        `${ORIGIN}/api/oauth/callback?code=abc&state=${cookieValue(stateCookie)}`,
        `${stateCookie.split(';')[0]}; ${returnToCookie.split(';')[0]}`,
      ))

      expect(response.headers.get('location')).toBe(returnTo)
    } finally {
      capture.restore()
    }
  })

  test('falls back to the configured destination for an unsafe stored target', async () => {
    const capture = captureSetCookie()
    try {
      const subject = flow({ returnTo: '/configured' })
      const stateCookie = login(subject).find(cookie => cookie.startsWith('basis_oauth_state=')) ?? ''

      const response = await subject.callback(requestFor(
        `${ORIGIN}/api/oauth/callback?code=abc&state=${cookieValue(stateCookie)}`,
        `${stateCookie.split(';')[0]}; basis_oauth_return_to=https%3A%2F%2Fevil.test`,
      ))

      expect(response.headers.get('location')).toBe('/configured')
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

      const identityCookie = capture.cookies.find(cookie => cookie.startsWith('auth.test=')) ?? ''
      expect(identityCookie).toContain('Max-Age=0')
    } finally {
      capture.restore()
    }
  })

  test('returns to a validated local target and rejects an external one', () => {
    const subject = flow()

    const local = subject.logout(requestFor(
      `${ORIGIN}/api/oauth/logout?returnTo=${encodeURIComponent('/some/random/path')}`,
    ))
    const sibling = subject.logout(requestFor(
      `${ORIGIN}/api/oauth/logout?returnTo=${encodeURIComponent('https://campaign.example.com/done')}`,
    ))
    const external = subject.logout(requestFor(
      `${ORIGIN}/api/oauth/logout?returnTo=${encodeURIComponent('https://evil.test/steal')}`,
    ))

    expect(local.headers.get('location')).toBe('/some/random/path')
    expect(sibling.headers.get('location')).toBe('https://campaign.example.com/done')
    expect(external.headers.get('location')).toBe('/')
  })
})

describe('Server.oauth', () => {
  test('mounts the login, callback, and logout routes', async () => {
    let seenHost: string | null = null
    const server = new Server().oauth({
      authorize: (state, _credentials, request) => {
        seenHost = request ? new URL(request.url).host : null
        return `https://provider.test/authorize?state=${state}`
      },
      exchange: async () => 'access-token',
      identity: async () => 'user-42',
      session: new Identity(CREDENTIALS),
    })

    const loginResponse = await server.handle(requestFor(`${ORIGIN}/api/oauth/login`))
    expect(loginResponse?.status).toBe(302)
    expect(loginResponse?.headers.get('location')).toContain('provider.test')
    expect(seenHost).toBe('app.example.com')
  })

  test('keeps OAuth routes independent of a failing application context loader', async () => {
    const server = new Server()
      .context(async () => {
        throw new Error('context unavailable')
      })
      .oauth({
        authorize: state => `https://provider.test/authorize?state=${state}`,
        exchange: async () => 'access-token',
        identity: async () => 'user-42',
        session: new Identity(CREDENTIALS),
      })
      .api([HttpVerb.Get], 'app', () => new Response('application'))

    const loginCookies = await (async () => {
      const capture = captureSetCookie()
      try {
        const response = await server.handle(requestFor(
          `${ORIGIN}/api/oauth/login?returnTo=${encodeURIComponent('/done')}`,
        ))
        expect(response?.status).toBe(302)
        return [...capture.cookies]
      } finally {
        capture.restore()
      }
    })()
    const stateCookie = loginCookies.find(cookie => cookie.startsWith('basis_oauth_state=')) ?? ''
    const returnToCookie = loginCookies.find(cookie => cookie.startsWith('basis_oauth_return_to=')) ?? ''

    const callback = await (async () => {
      const capture = captureSetCookie()
      try {
        return await server.handle(requestFor(
          `${ORIGIN}/api/oauth/callback?code=abc&state=${cookieValue(stateCookie)}`,
          `${stateCookie.split(';')[0]}; ${returnToCookie.split(';')[0]}`,
        ))
      } finally {
        capture.restore()
      }
    })()
    expect(callback?.status).toBe(302)
    expect(callback?.headers.get('location')).toBe('/done')

    const logout = await server.handle(requestFor(
      `${ORIGIN}/api/oauth/logout?returnTo=${encodeURIComponent('/done')}`,
    ))
    expect(logout?.status).toBe(302)
    expect(logout?.headers.get('location')).toBe('/done')

    await expect(server.handle(requestFor(`${ORIGIN}/api/app`)))
      .rejects.toThrow('context unavailable')
  })
})
