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

/** How long an authorization round trip has to finish. */
const STATE_MAX_AGE_SECONDS = 600

/** Options accepted by {@link OAuth}. */
export interface OAuthOptions {
  /**
   * Build the provider authorize URL for a state value, using the client
   * credentials. Called on login; the caller closes over its provider's
   * endpoint, redirect URI, and scopes.
   */
  authorize: (state: string, credentials: IdentityCredentials) => string,
  /**
   * Exchange an authorization code for an access token, or `null` on failure.
   * Called on callback with the client credentials.
   */
  exchange: (code: string, credentials: IdentityCredentials) => Promise<string | null>,
  /**
   * Resolve the signed-in user id from an access token, or `null` on failure.
   * Called on callback.
   */
  identity: (accessToken: string) => Promise<string | null>,
  /** Optional logger for flow failures. */
  logger?: ILogger,
  /** Where to send the browser after a successful callback. Defaults to `/`. */
  returnTo?: string,
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
   * @returns A redirect to the provider authorize URL.
   */
  login(): Response {
    const state = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      byte => byte.toString(16).padStart(2, '0'),
    ).join('')
    const headers = new Headers({ Location: this.#options.authorize(state, this.#credentials()) })
    headers.append('Set-Cookie', serializeCookie(STATE_COOKIE, state, { maxAgeSeconds: this.#stateMaxAge() }))
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
      return this.#failure('invalid_state', 400)
    }

    let accessToken: string | null
    try {
      accessToken = await this.#options.exchange(code, this.#credentials())
    } catch (error) {
      return this.#failure('exchange_failed', 401, error)
    }
    if (accessToken === null) return this.#failure('exchange_failed', 401)

    let userId: string | null
    try {
      userId = await this.#options.identity(accessToken)
    } catch (error) {
      return this.#failure('identity_failed', 401, error)
    }
    if (userId === null) return this.#failure('identity_failed', 401)

    const headers = new Headers({ Location: this.#options.returnTo ?? '/' })
    headers.append('Set-Cookie', serializeCookie(STATE_COOKIE, '', { maxAgeSeconds: 0 }))
    this.#options.session.set(request, headers, userId)
    return new Response(null, { headers, status: 302 })
  }

  /**
   * End the session by clearing the identity cookie at its configured scope.
   * @param request - The incoming request.
   * @returns A redirect back to the application.
   */
  logout(request: Request): Response {
    const headers = new Headers({ Location: this.#options.returnTo ?? '/' })
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
    headers.append('Set-Cookie', serializeCookie(STATE_COOKIE, '', { maxAgeSeconds: 0 }))
    return new Response(JSON.stringify({ error: reason }), { headers, status })
  }

  /**
   * The configured state lifetime.
   * @returns Lifetime in seconds.
   */
  #stateMaxAge(): number {
    return this.#options.stateMaxAgeSeconds ?? STATE_MAX_AGE_SECONDS
  }
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
