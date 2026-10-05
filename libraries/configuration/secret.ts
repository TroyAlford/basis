/**
 * Runtime 1Password secret reads.
 *
 * `secret<T>(reference)` reads one `op://` reference through the 1Password CLI
 * (`op read <reference>`) and returns the value typed as `T`. 1Password is the
 * only store: the reader never caches, never persists, and never injects a
 * value into a process environment — every call talks to 1Password directly.
 *
 * The Service Account token is a credential supplied to the `op` child only. It
 * is never logged, never returned, and never echoed; a missing token fails
 * closed before any subprocess is started. The token and `PATH` form the
 * child's environment, and the reference is the sole argument — never a value.
 */

import type { CommandResult, RunOptions } from './run'
import { run as defaultRun } from './run'

/** The `op` executable resolved on `PATH` when no override is supplied. */
const DEFAULT_OP_BIN = 'op'

/** How long the `op` child may run before it is killed. */
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * A synchronous subprocess runner, injectable so a caller can substitute a
 * fake in tests. {@link run} satisfies this shape.
 */
export type SecretCommandRunner = (
  command: string,
  args: readonly string[],
  options?: RunOptions,
) => CommandResult

/** Read a single secret reference from 1Password. */
export interface SecretReader {
  /**
   * Read one reference and return it typed as `T`.
   * @param reference - A 1Password `op://` reference.
   * @returns The current value, parsed by its JSON shape.
   */
  secret<T>(reference: string): T,
}

/** Options for {@link createSecretReader}. */
export interface CreateSecretReaderOptions {
  /** 1Password CLI executable; defaults to `op` on `PATH`. */
  readonly opBin?: string,
  /** Runner used to spawn `op`; defaults to the shared {@link run}. */
  readonly runner?: SecretCommandRunner,
  /** How long the `op` child may run before it is killed. */
  readonly timeoutMs?: number,
  /**
   * Service Account token, or `null` when 1Password reads are unconfigured. A
   * missing token fails closed; it is never injected into an application.
   */
  readonly token: string | null,
}

/** Raised when a secret reference cannot be read. Never contains a value. */
export class SecretReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SecretReadError'
  }
}

/**
 * Create a 1Password-backed {@link SecretReader}.
 * @param options - Runner, token, and optional `op`/timeout overrides.
 * @returns The reader.
 */
export function createSecretReader(options: CreateSecretReaderOptions): SecretReader {
  const opBin = options.opBin ?? DEFAULT_OP_BIN
  const runner = options.runner ?? defaultRun
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    secret<T>(reference: string): T {
      const token = options.token
      if (token === null || token.length === 0) {
        throw new SecretReadError('1Password Service Account token is not configured')
      }

      /*
       * The `op` CLI reads `OP_SERVICE_ACCOUNT_TOKEN`; it is the variable the
       * child actually consumes. The runner receives it together with `PATH`,
       * and the reference — never a value — is the sole argument.
       */
      const env: Record<string, string> = { OP_SERVICE_ACCOUNT_TOKEN: token }
      if (typeof process.env.PATH === 'string') env.PATH = process.env.PATH

      let result: CommandResult
      try {
        result = runner(opBin, ['read', reference], { env, timeoutMs })
      } catch (cause) {
        throw new SecretReadError(`failed to read secret reference ${reference}`, { cause })
      }
      if (result.exitCode !== 0) {
        throw new SecretReadError(`failed to read secret reference ${reference}`)
      }
      return parseSecretValue<T>(result.stdout)
    },
  }
}

/**
 * Read one secret reference from 1Password using the ambient
 * `OP_SERVICE_ACCOUNT_TOKEN` and the shared {@link run} runner.
 * @param reference - A 1Password `op://` reference.
 * @returns The current value, parsed by its JSON shape.
 * @throws {SecretReadError} When the token is unset or `op read` fails.
 */
export function secret<T>(reference: string): T {
  const raw = Bun.env.OP_SERVICE_ACCOUNT_TOKEN?.trim()
  const token = raw === undefined || raw.length === 0 ? null : raw
  return createSecretReader({ token }).secret<T>(reference)
}

/**
 * Parse `op read` output by shape: a JSON object, array, number, or boolean is
 * returned parsed, while a plain string is returned raw with one trailing
 * newline removed. `T` is erased at runtime, so this is a shape heuristic, not a
 * type check.
 * @param raw - Raw `op read` standard output.
 * @returns The value typed as `T`.
 */
function parseSecretValue<T>(raw: string): T {
  const text = stripTrailingNewline(raw)
  if (text.length === 0) return text as unknown as T
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed !== null && typeof parsed !== 'string') return parsed as T
  } catch {
    // Not JSON: a plain string secret, returned as-is.
  }
  return text as unknown as T
}

/**
 * Remove a single trailing newline from CLI output.
 * @param value - Raw output.
 * @returns The value without one trailing newline.
 */
function stripTrailingNewline(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  return value.endsWith('\n') ? value.slice(0, -1) : value
}
