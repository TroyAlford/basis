/**
 * A provider-agnostic OAuth authorization-code flow built on {@link Identity}.
 *
 * The flow owns the parts every provider shares — a CSRF state cookie, the
 * authorize redirect, the callback's code exchange and user resolution, and
 * the session cookie — while the provider specifics stay with the caller:
 * `authorize`, `exchange`, and `identity` are injected, and credentials come
 * from the {@link Identity} capability. A consumer therefore wires any OAuth
 * provider (Discord, GitHub, Google, …) without reimplementing the dance.
 *
 * Failures never log a code, token, or credential; they return a small JSON
 * error.
 */

import { readCookie, serializeCookie } from '../../oauth/cookies'
import type { Identity, IdentityCredentials } from '../../oauth/identity'
import { IDENTITY_CREDENTIALS } from '../../oauth/identity'
import type { ILogger } from '../../utilities'

/** Cookie holding the CSRF state for one authorization round trip. */
const STATE_COOKIE = 'basis_oauth_state'

/** Cookie holding the validated post-login destination. */
const RETURN_TO_COOKIE = 'basis_oauth_return_to'

/** How long an authorization round trip has to finish. */
const STATE_MAX_AGE_SECONDS = 600

/** Optional verified profile returned alongside a provider subject. */
export interface OAuthIdentity {
  /** Human-readable display name. */
  readonly displayName?: string,
  /** Verified email address. */
  readonly email?: string,
  /** Stable provider subject. */
  readonly subject: string,
}

/** Options accepted by {@link OAuth}. */
export interface OAuthOptions {
  /**
   * Build the provider authorize URL for a state value, using the client
   * credentials. Called on login; the caller closes over its provider's
   * endpoint and scopes, and uses the request for the redirect URI when the
   * application answers on more than one host.
   */
  authorize: (state: string, credentials: IdentityCredentials, request?: Request) => string,
  /** Optional shared domain for the one-shot state and return cookies. */
  cookieDomain?: string,
  /**
   * Exchange an authorization code for an access token, or `null` on failure.
   * Called on callback with the client credentials and the callback request.
   */
  exchange: (code: string, credentials: IdentityCredentials, request?: Request) => Promise<string | null>,
  /**
   * Resolve the provider subject and optional profile from an access token, or
   * `null` on failure. Called on callback.
   */
  identity: (accessToken: string) => Promise<string | OAuthIdentity | null>,
  /** Optional logger for flow failures. */
  logger?: ILogger,
  /** Fallback destination when a request has no valid `returnTo`. Defaults to `/`. */
  returnTo?: string,
  /**
   * Explicit domains that may receive cross-host return targets, including their
   * subdomains. Omit to allow only the request's own origin.
   */
  returnToDomains?: readonly string[],
  /** The identity cookie capability used to sign the session in and out. */
  session: Identity,
  /** State cookie lifetime in seconds. Defaults to 600. */
  stateMaxAgeSeconds?: number,
}

/**
 * The provider-agnostic OAuth authorization-code flow.
 *
 * `login`, `callback`, and `logout` return responses a Basis server can route
 * to; `session` reads the verified user id for any request.
 */
export class OAuth {
  #options: OAuthOptions

  /**
   * Build the flow.
   * @param options - Provider seams, the session capability, and optional policy.
   */
  constructor(options: OAuthOptions) {
    this.#options = options
  }

  /**
   * Begin a sign-in: set the CSRF state cookie and redirect to the provider.
   * @param request - The login request, when routed through a server.
   * @returns A redirect to the provider authorize URL.
   */
  login(request?: Request): Response {
    const state = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      byte => byte.toString(16).padStart(2, '0'),
    ).join('')
    const returnTo = request
      ? safeReturnTo(new URL(request.url).searchParams.get('returnTo'), request, this.#options.returnToDomains)
      : null
    const headers = new Headers({ Location: this.#options.authorize(state, this.#credentials(), request) })
    headers.append('Set-Cookie', serializeCookie(STATE_COOKIE, state, this.#cookieOptions()))
    if (returnTo !== null) {
      headers.append('Set-Cookie', serializeCookie(
        RETURN_TO_COOKIE,
        encodeURIComponent(returnTo),
        this.#cookieOptions(),
      ))
    }
    return new Response(null, { headers, status: 302 })
  }

  /**
   * Finish a sign-in: verify the state, exchange the code, resolve the user id,
   * and set the identity cookie before redirecting back to the application.
   * @param request - The provider's callback request.
   * @returns A redirect on success, or a JSON error when the round trip fails.
   */
  async callback(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const expected = readCookie(request.headers.get('cookie'), STATE_COOKIE)

    if (code === null || state === null || expected === null || !sameState(state, expected)) {
      let reason = 'state_mismatch'
      if (code === null) reason = 'missing_code'
      else if (state === null) reason = 'missing_state'
      else if (expected === null) reason = 'missing_state_cookie'
      this.#options.logger?.info(`oauth invalid_state: ${reason}`)
      return this.#failure('invalid_state', 400)
    }

    let accessToken: string | null
    try {
      accessToken = await this.#options.exchange(code, this.#credentials(), request)
    } catch (error) {
      return this.#failure('exchange_failed', 401, error)
    }
    if (accessToken === null) return this.#failure('exchange_failed', 401)

    let identity: string | OAuthIdentity | null
    try {
      identity = await this.#options.identity(accessToken)
    } catch (error) {
      return this.#failure('identity_failed', 401, error)
    }
    const userId = typeof identity === 'string' ? identity : identity?.subject ?? null
    if (userId === null) return this.#failure('identity_failed', 401)

    const returnTo = safeReturnTo(
      decodeReturnTo(readCookie(request.headers.get('cookie'), RETURN_TO_COOKIE)),
      request,
      this.#options.returnToDomains,
    ) ?? this.#options.returnTo ?? '/'
    const headers = new Headers({ Location: returnTo })
    headers.append('Set-Cookie', serializeCookie(STATE_COOKIE, '', this.#cookieOptions(0)))
    headers.append('Set-Cookie', serializeCookie(RETURN_TO_COOKIE, '', this.#cookieOptions(0)))
    this.#options.session.set(request, headers, userId)
    return new Response(null, { headers, status: 302 })
  }

  /**
   * End the session by clearing the identity cookie at its configured scope.
   * @param request - The incoming request.
   * @returns A redirect back to the application.
   */
  logout(request: Request): Response {
    const returnTo = safeReturnTo(
      new URL(request.url).searchParams.get('returnTo'),
      request,
      this.#options.returnToDomains,
    ) ?? this.#options.returnTo ?? '/'
    const headers = new Headers({ Location: returnTo })
    this.#options.session.set(request, headers, null)
    return new Response(null, { headers, status: 302 })
  }

  /**
   * Read the verified user id for a request.
   * @param request - The incoming request.
   * @returns The user id, or `null` when the request is anonymous.
   */
  session(request: Request): string | null {
    return this.#options.session.get(request)
  }

  /**
   * The resolved client credentials the flow hands to the provider seams.
   * @returns The client id and secret.
   */
  #credentials(): IdentityCredentials {
    return this.#options.session[IDENTITY_CREDENTIALS]()
  }

  /**
   * Build a failure response, clearing the one-shot state cookie.
   * @param reason - Machine-readable error code.
   * @param status - HTTP status.
   * @param cause - Optional underlying error, logged but never returned.
   * @returns The JSON error response.
   */
  #failure(reason: string, status: number, cause?: unknown): Response {
    if (cause !== undefined) {
      const message = cause instanceof Error ? cause.message : String(cause)
      this.#options.logger?.error(`oauth ${reason}: ${message}`)
    }
    const headers = new Headers({ 'Content-Type': 'application/json' })
    headers.append('Set-Cookie', serializeCookie(STATE_COOKIE, '', this.#cookieOptions(0)))
    headers.append('Set-Cookie', serializeCookie(RETURN_TO_COOKIE, '', this.#cookieOptions(0)))
    return new Response(JSON.stringify({ error: reason }), { headers, status })
  }

  /**
   * The configured state lifetime.
   * @returns Lifetime in seconds.
   */
  #stateMaxAge(): number {
    return this.#options.stateMaxAgeSeconds ?? STATE_MAX_AGE_SECONDS
  }

  /**
   * Cookie attributes for the one-shot state and return cookies.
   * @param maxAgeSeconds - Lifetime in seconds.
   * @returns Cookie options, including the configured shared domain.
   */
  #cookieOptions(maxAgeSeconds = this.#stateMaxAge()): { domain?: string, maxAgeSeconds: number } {
    return this.#options.cookieDomain
      ? { domain: this.#options.cookieDomain, maxAgeSeconds }
      : { maxAgeSeconds }
  }
}

/**
 * Decode a stored return target, rejecting malformed values.
 * @param value - Encoded cookie value, or `null`.
 * @returns The decoded target, or `null`.
 */
function decodeReturnTo(value: string | null): string | null {
  if (value === null) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * Resolve the public request origin after a reverse proxy.
 * @param request - The incoming request.
 * @returns The request URL with forwarded host and protocol, when present.
 */
function publicRequestURL(request: Request): URL {
  const url = new URL(request.url)
  const host = firstHeader(request, 'x-forwarded-host') ?? request.headers.get('host')
  const protocol = firstHeader(request, 'x-forwarded-proto')?.toLowerCase()
  if (host) {
    try {
      const publicHost = new URL(`http://${host}`)
      url.hostname = publicHost.hostname
      url.port = publicHost.port
    } catch {
      // Keep the request URL when a proxy supplies an invalid host.
    }
  }
  if (protocol === 'http' || protocol === 'https') url.protocol = `${protocol}:`
  return url
}

/**
 * Read the first value of a comma-separated request header.
 * @param request - The incoming request.
 * @param name - Header name.
 * @returns The first trimmed value, or null.
 */
function firstHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name)
  return value?.split(',')[0]?.trim() || null
}

/**
 * Accept a relative path on the current origin, or an absolute URL on the
 * current origin or an explicitly trusted application domain.
 * @param value - Candidate return target.
 * @param request - The login, callback, or logout request.
 * @param domains - Explicit trusted domains, including their subdomains.
 * @returns A safe path or absolute URL, or `null` when the candidate is unsafe.
 */
function safeReturnTo(
  value: string | null,
  request: Request,
  domains: readonly string[] = [],
): string | null {
  if (value === null || value === '' || value.includes('\\')) return null
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x20 || code === 0x7f) return null
  }

  const base = publicRequestURL(request)
  let target: URL
  try {
    target = new URL(value, base)
  } catch {
    return null
  }

  if (target.username !== '' || target.password !== '') return null
  if (value.startsWith('/')) {
    return target.origin === base.origin
      ? `${target.pathname}${target.search}${target.hash}`
      : null
  }

  if (target.origin === base.origin) return target.href
  if (target.protocol !== base.protocol || target.port !== base.port) return null
  return isTrustedReturnHost(target.hostname, domains) ? target.href : null
}

/**
 * Whether a target host is one of the explicitly trusted domains or its subdomains.
 * @param hostname - Target hostname.
 * @param domains - Explicit trusted domains.
 * @returns True when the target host is trusted.
 */
function isTrustedReturnHost(hostname: string, domains: readonly string[]): boolean {
  const candidate = hostname.toLowerCase()
  return domains.some(domain => {
    const trusted = domain.trim().toLowerCase().replace(/^\./, '')
    return trusted.length > 0 && (candidate === trusted || candidate.endsWith(`.${trusted}`))
  })
}

/**
 * Compare two state values without leaking where they differ.
 * @param a - One value.
 * @param b - The other.
 * @returns True when they are equal.
 */
function sameState(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index++) diff |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return diff === 0
}
