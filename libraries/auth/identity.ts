/**
 * The identity cookie's value: a user id encrypted with a provider secret.
 *
 * The value is stateless and self-describing: `<version>.<payload>`. The
 * version prefix lets the scheme evolve, and the payload is the base64url
 * encoding of one AES-256-GCM blob — the 12-byte nonce, the 16-byte
 * authentication tag, then the ciphertext. Decryption is authenticated, so a
 * tampered value or a wrong secret reads back as `null` rather than an
 * attacker-chosen user id.
 *
 * The key is SHA-256 over a fixed context and the caller's provider secret, so
 * that secret must be high-entropy (a provider/client secret): the derivation
 * is a fast hash, not a password-stretching function. Versioning the context
 * keeps future schemes on independent keys.
 *
 * Nothing here logs. A plaintext user id and a secret never appear in an error
 * message, a thrown value, or any other output.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** Version prefix for the current scheme. */
const VERSION = 'v1'

/** Domain separation for the key derivation, so a secret is never used raw. */
const KEY_CONTEXT = 'basis/auth/identity'

/** AES-256-GCM nonce length in bytes. */
const NONCE_BYTES = 12

/** AES-256-GCM authentication tag length in bytes. */
const TAG_BYTES = 16

/** Additional authenticated data, binding the version prefix into the tag. */
const AAD = Buffer.from(VERSION, 'utf8')

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
 * Encrypt a user id into the identity cookie value.
 * @param userId - The authenticated user id.
 * @param secret - High-entropy provider secret.
 * @returns The versioned, base64url value to place in the cookie.
 */
export function encryptIdentity(userId: string, secret: string): string {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(AAD)
  const ciphertext = Buffer.concat([cipher.update(userId, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${VERSION}.${Buffer.concat([nonce, tag, ciphertext]).toString('base64url')}`
}

/**
 * Decrypt an identity cookie value.
 *
 * The user id is returned only when the value carries a known version prefix,
 * decodes to a complete authenticated blob, and authenticates under the
 * supplied secret. Every other case — tampering, a wrong secret, a truncated
 * value, an unknown version, or a missing cookie — returns `null`.
 * @param value - Cookie value, or `null` when absent.
 * @param secret - High-entropy provider secret.
 * @returns The user id, or `null` when the value cannot be trusted.
 */
export function readIdentity(value: string | null, secret: string): string | null {
  if (value === null) return null

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
