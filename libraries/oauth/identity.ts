/**
 * The shared identity cookie: a user id sealed with a provider secret.
 *
 * `Identity` is one capability. It owns the cookie's name, the sealed value's
 * format, and its browser scope, so a consumer signs a user in with
 * `set(request, headers, userId)` and reads the verified user id back with
 * `get(request)` — never touching crypto, cookie names, serialization, or
 * hostname parsing.
 *
 * The value is `<version>.<payload>`; the version prefix lets the scheme
 * evolve, and the payload is the base64url encoding of one AES-256-GCM blob —
 * the 12-byte nonce, the 16-byte authentication tag, then the ciphertext.
 * Decryption is authenticated, so a tampered value or a wrong secret reads
 * back as `null` rather than an attacker-chosen identity.
 *
 * The key is SHA-256 over a fixed context and the resolved provider secret.
 * The secret must be high-entropy (a provider/client secret): the derivation is
 * a fast hash, not a password-stretching function. Credentials may be literals
 * or `op://` references, which are resolved through `basis/configuration`'s
 * `secret()` the first time they are needed.
 *
 * Nothing here logs. A user id and a secret never appear in an error message,
 * a thrown value, or any other output.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { secret as readSecret } from '../configuration/secret'
import { readCookie, serializeCookie } from './cookies'

/** Version prefix for the current scheme. */
const VERSION = 'v1'

/** Ownership namespace for the key derivation, so a secret is never used raw. */
const KEY_CONTEXT = 'basis/oauth/identity'

/** AES-256-GCM nonce length in bytes. */
const NONCE_BYTES = 12

/** AES-256-GCM authentication tag length in bytes. */
const TAG_BYTES = 16

/** Thirty days, the default identity lifetime in seconds. */
const DEFAULT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/** Additional authenticated data, binding the version prefix into the tag. */
const AAD = Buffer.from(VERSION, 'utf8')

/**
 * The two browser cookie scopes an identity can use. There are exactly two,
 * because browsers offer exactly two ways to scope a cookie.
 *
 * Exported for the sibling OAuth flow and tests only; the package surface
 * reaches it as `Identity.Scope`.
 */
export enum Scope {
  /**
   * Share the cookie with the parent domain and its descendants, by writing
   * `Domain=<parent>`. The parent is derived by removing the request's current
   * subdomain; when the host has no parent a browser would accept (two labels
   * or fewer), this degrades to {@link Scope.Subdomain}.
   */
  Domain = 'domain',
  /** Host-only: the exact request hostname, with no `Domain` attribute. */
  Subdomain = 'subdomain',
}

/**
 * Options accepted by the {@link Identity} constructor. Policy lives here and
 * nowhere else: there is no per-call cookie name, domain, secret, or lifetime.
 */
interface IdentityOptions {
  /** Lifetime in seconds. Defaults to 30 days. */
  readonly maxAgeSeconds?: number,
  /**
   * OAuth provider slug. The identity cookie is named `auth.<provider>`
   * (`auth.github`, `auth.discord`), so a host-only cookie for one provider
   * cannot collide with a sibling's domain-scoped one.
   */
  readonly provider: string,
  /** OAuth client id; may be an `op://` reference. */
  readonly public: string,
  /** Cookie scope. Defaults to {@link Scope.Subdomain}. */
  readonly scope?: Scope,
  /** OAuth client secret used to seal the value; may be an `op://` reference. */
  readonly secret: string,
}

/**
 * Resolved OAuth client credentials. Shared with the sibling OAuth flow through
 * {@link IDENTITY_CREDENTIALS}; not part of the package surface.
 */
export interface IdentityCredentials {
  /** OAuth client id. */
  readonly public: string,
  /** OAuth client secret. */
  readonly secret: string,
}

/**
 * Internal accessor key for resolved credentials. It is a symbol, and is not
 * re-exported from the package, so a consumer cannot reach a secret by accident.
 */
export const IDENTITY_CREDENTIALS = Symbol('basis/oauth/identity-credentials')

/**
 * The shared identity cookie.
 *
 * The default scope is host-only (`Subdomain`); pass `Identity.Scope.Domain` to
 * share the cookie with the parent domain and its descendants.
 */
export class Identity {
  /** The available cookie scopes: `Identity.Scope.Domain` / `.Subdomain`. */
  static readonly Scope = Scope

  #maxAgeSeconds: number
  #name: string
  #options: IdentityOptions
  #resolved: IdentityCredentials | null = null

  /**
   * Build an identity capability.
   * @param options - Credentials and optional policy (see {@link IdentityOptions}).
   */
  constructor(options: IdentityOptions) {
    this.#options = options
    this.#maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS
    this.#name = `auth.${options.provider}`
  }

  /**
   * Resolve the OAuth client credentials, for the sibling OAuth flow.
   *
   * Internal: reached only through {@link IDENTITY_CREDENTIALS}, which the
   * package does not export, so consumers never hold the sealing secret.
   * @returns The resolved client id and secret.
   */
  [IDENTITY_CREDENTIALS](): IdentityCredentials {
    this.#resolved ??= {
      public: resolveCredential(this.#options.public),
      secret: resolveCredential(this.#options.secret),
    }
    return this.#resolved
  }

  /**
   * Read the verified user id from a request's identity cookie.
   * @param request - The incoming request.
   * @returns The user id, or `null` when the request is not signed in, the
   * cookie is absent, or the value does not authenticate.
   */
  get(request: Request): string | null {
    const value = readCookie(request.headers.get('cookie'), this.#name)
    if (value === null) return null
    return readIdentity(value, this[IDENTITY_CREDENTIALS]().secret)
  }

  /**
   * Set or clear the identity cookie on a response.
   *
   * Passing a user id signs the request's host in for the configured lifetime,
   * scoped per the configured {@link Scope}. Passing `null` clears the cookie at
   * the same scope, which is the logout path.
   * @param request - The request the response answers, used for the host scope.
   * @param headers - Response headers to append `Set-Cookie` to, in place.
   * @param userId - The authenticated user id, or `null` to clear.
   */
  set(request: Request, headers: Headers, userId: string | null): void {
    const domain = this.#domainFor(request)

    if (userId === null) {
      headers.append('Set-Cookie', serializeCookie(this.#name, '', {
        ...(domain === null ? {} : { domain }),
        maxAgeSeconds: 0,
      }))
      return
    }

    const sealed = encryptIdentity(userId, this[IDENTITY_CREDENTIALS]().secret)
    headers.append('Set-Cookie', serializeCookie(this.#name, sealed, {
      ...(domain === null ? {} : { domain }),
      maxAgeSeconds: this.#maxAgeSeconds,
    }))
  }

  /**
   * The `Domain` attribute to write, or `null` for host-only.
   *
   * Only `Domain` scope writes an attribute; `Subdomain` is host-only. The
   * parent is the host with its current subdomain removed.
   * @param request - The request being answered.
   * @returns The parent domain, or `null` when the cookie must stay host-only.
   */
  #domainFor(request: Request): string | null {
    if (this.#options.scope !== Scope.Domain) return null
    return parentDomain(new URL(request.url).hostname)
  }
}

/**
 * Derive the parent domain by removing the request host's current subdomain —
 * the first label. Returns `null` when the host is two labels or fewer, because
 * there is no parent a browser would accept and the only achievable scope is
 * host-only.
 *
 * This assumes a single subdomain label, so it does not need the public suffix
 * list: `auth.example.co.uk` → `example.co.uk`, `cc.troyalford.com` →
 * `troyalford.com`, `example.com` → `null`, `foo.localhost` → `null`.
 * @param hostname - The lowercased request hostname.
 * @returns The parent domain, or `null`.
 */
function parentDomain(hostname: string): string | null {
  const labels = hostname.split('.')
  if (labels.length <= 2) return null
  const parent = labels.slice(1).join('.')
  return parent.includes('.') ? parent : null
}

/**
 * Resolve one credential, reading an `op://` reference through Basis's
 * `secret()` and otherwise returning the literal.
 * @param value - A literal credential or an `op://` reference.
 * @returns The resolved credential.
 */
function resolveCredential(value: string): string {
  return value.startsWith('op://') ? readSecret(value) : value
}

/**
 * Derive the 32-byte AES key for one secret under the current format version.
 * @param secret - High-entropy provider secret.
 * @returns The key bytes.
 */
function deriveKey(secret: string): Buffer {
  return createHash('sha256')
    .update(KEY_CONTEXT)
    .update('\0')
    .update(VERSION)
    .update('\0')
    .update(secret)
    .digest()
}

/**
 * Seal a user id into the identity cookie value.
 * @param userId - The authenticated user id.
 * @param secret - High-entropy provider secret.
 * @returns The versioned, base64url value.
 */
function encryptIdentity(userId: string, secret: string): string {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(AAD)
  const ciphertext = Buffer.concat([cipher.update(userId, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${VERSION}.${Buffer.concat([nonce, tag, ciphertext]).toString('base64url')}`
}

/**
 * Open an identity cookie value, returning the user id only when the value
 * decodes and authenticates under the secret.
 * @param value - The cookie value.
 * @param secret - High-entropy provider secret.
 * @returns The user id, or `null` when the value cannot be trusted.
 */
function readIdentity(value: string, secret: string): string | null {
  const separator = value.indexOf('.')
  if (separator === -1) return null
  if (value.slice(0, separator) !== VERSION) return null

  const payload = value.slice(separator + 1)
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return null

  const blob = Buffer.from(payload, 'base64url')
  if (blob.length <= NONCE_BYTES + TAG_BYTES) return null

  const nonce = blob.subarray(0, NONCE_BYTES)
  const tag = blob.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES)
  const ciphertext = blob.subarray(NONCE_BYTES + TAG_BYTES)

  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), nonce, { authTagLength: TAG_BYTES })
    decipher.setAAD(AAD)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
