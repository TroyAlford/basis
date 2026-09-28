import { hash } from '../../utilities/functions/hash'

/**
 * Generate a short, stable-length internal id.
 *
 * Uses `crypto.randomUUID()` when available with a time/random fallback, then
 * hashes the result to a fixed-length string suitable for React keys and DOM
 * ids. Each call produces a distinct id that does not depend on module or mount
 * order.
 * @returns A short hash string.
 */
export const createId = (): string => {
  const raw = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}-${Math.random()}`
  return hash(raw, { length: 12 })
}
