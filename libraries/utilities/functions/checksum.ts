import { createHash } from 'node:crypto'

/** Options for deterministic checksum calculation. */
export interface ChecksumOptions {
  /** Sort object keys recursively before serializing structured values. */
  readonly stable?: boolean,
}

/**
 * Recursively order object keys for deterministic structured checksums.
 * @param value - JSON-compatible value.
 * @returns Stable value.
 */
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, stableValue(nested)]),
  )
}

/**
 * Calculate a SHA-256 checksum for structured data or raw bytes.
 *
 * Strings and byte arrays are hashed exactly as supplied. Structured values
 * use stable recursive key ordering by default so equivalent object shapes hash
 * identically. Pass `{ stable: false }` only when preserving an existing byte
 * layout.
 * @param value - Structured value, string, or raw bytes.
 * @param options - Serialization options.
 * @returns Lowercase SHA-256 hex digest.
 */
export function checksum(value: unknown, options: ChecksumOptions = {}): string {
  const input = typeof value === 'string'
    ? value
    : value instanceof Uint8Array
      ? value
      : JSON.stringify(options.stable === false ? value : stableValue(value))
  return createHash('sha256').update(input).digest('hex')
}
