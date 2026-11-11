import { createHash } from 'node:crypto'
import { basename } from 'node:path'

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
 * Calculate a checksum from one file using a bounded-memory native digest command.
 * @param file - Bun file handle.
 * @returns Lowercase SHA-256 hex digest.
 */
async function fileChecksum(file: Blob): Promise<string> {
  const path = (file as { name?: string }).name
  if (!path) throw new Error('checksum(file) requires a Bun.file with a filesystem path')
  const command = process.platform === 'darwin' ? 'shasum' : 'sha256sum'
  const args = process.platform === 'darwin'
    ? ['-a', '256', '--', path]
    : ['--', path]
  const child = Bun.spawn([command, ...args], { stderr: 'pipe', stdout: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) {
    throw new Error(`${command} failed for ${basename(path)}: ${stderr.trim() || `exit ${code}`}`)
  }
  const digest = stdout.trim().split(/\s+/u, 1)[0] ?? ''
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`${command} returned an invalid SHA-256 digest for ${basename(path)}`)
  }
  return digest
}

/**
 * Calculate a SHA-256 checksum for structured data, raw bytes, or a file.
 *
 * Strings and byte arrays are hashed exactly as supplied. Structured values
 * use stable recursive key ordering by default so equivalent object shapes hash
 * identically. Pass `{ stable: false }` only when preserving an existing byte
 * layout. A Bun file handle uses the native digest command and resolves
 * asynchronously without loading the file into application memory.
 * @param value - Structured value, string, raw bytes, or Bun file.
 * @returns Lowercase SHA-256 hex digest, or a promise for file input.
 */
export function checksum(value: Blob): Promise<string>
export function checksum(value: unknown, options?: ChecksumOptions): string
export function checksum(value: unknown, options: ChecksumOptions = {}): string | Promise<string> {
  if (value instanceof Blob || Object.prototype.toString.call(value) === '[object Blob]') {
    return fileChecksum(value as Blob)
  }
  const input = typeof value === 'string'
    ? value
    : value instanceof Uint8Array
      ? value
      : JSON.stringify(options.stable === false ? value : stableValue(value))
  return createHash('sha256').update(input).digest('hex')
}
