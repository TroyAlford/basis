/**
 * Runtime 1Password secret reads.
 *
 * `secret(reference)` runs `op read <reference>` through the shared {@link run}
 * and returns the value as a string. To read structured configuration, callers
 * parse it themselves (for example `JSON.parse(secret('op://Vault/item/json'))`).
 * 1Password is the only store: the read never caches, never persists, and never
 * injects a value into a process environment.
 *
 * The Service Account token is read from `OP_SERVICE_ACCOUNT_TOKEN` and handed
 * to the `op` child under that same name — the variable `op` actually reads.
 * The shared runner overlays that onto the process environment, so `PATH` and
 * everything else the host already exports remain available to the child; only
 * the token is overridden. A missing token fails closed before any subprocess
 * starts. The reference is the sole argument, and neither the token nor the
 * value is ever logged or echoed.
 */

import type { CommandResult, RunOptions } from './run'
import { run as defaultRun } from './run'

/** The `op` executable, resolved by name on `PATH`. */
const OP_EXECUTABLE = 'op'

/** How long the `op` child may run before it is killed. */
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * A synchronous subprocess runner, used only to invoke `op`. {@link run}
 * satisfies this shape; tests inject a fake.
 */
export type SecretCommandRunner = (
  command: string,
  args: readonly string[],
  options?: RunOptions,
) => CommandResult

/** A reader that resolves one 1Password reference. */
export interface SecretReader {
  /**
   * Read one reference and return it as a string.
   * @param reference - A 1Password `op://` reference.
   * @returns The value with a single trailing newline removed.
   */
  secret(reference: string): string,
}

/** Options for the internal {@link createSecretReader} seam. */
export interface CreateSecretReaderOptions {
  /**
   * `op` executable to invoke; defaults to `op` on `PATH`. A private test seam
   * — the public {@link secret} always resolves `op` by name.
   */
  readonly executable?: string,
  /** Runner used to spawn `op`; defaults to the shared {@link run}. */
  readonly runner?: SecretCommandRunner,
  /** How long the `op` child may run before it is killed. */
  readonly timeoutMs?: number,
  /**
   * Service Account token, or `null` when 1Password reads are unconfigured. A
   * missing token fails closed.
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
 * Create a 1Password-backed {@link SecretReader}. Internal seam: {@link secret}
 * is the package's public way to read a reference.
 * @param options - Runner, token, and optional executable/timeout overrides.
 * @returns The reader.
 */
export function createSecretReader(options: CreateSecretReaderOptions): SecretReader {
  const executable = options.executable ?? OP_EXECUTABLE
  const runner = options.runner ?? defaultRun
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    secret(reference: string): string {
      const token = options.token
      if (token === null || token.length === 0) {
        throw new SecretReadError('1Password Service Account token is not configured')
      }

      let result: CommandResult
      try {
        result = runner(executable, ['read', reference], {
          env: { OP_SERVICE_ACCOUNT_TOKEN: token },
          timeoutMs,
        })
      } catch (cause) {
        throw new SecretReadError(`failed to read secret reference ${reference}`, { cause })
      }
      if (result.exitCode !== 0) {
        throw new SecretReadError(`failed to read secret reference ${reference}`)
      }
      return stripTrailingNewline(result.stdout)
    },
  }
}

/**
 * Read one secret reference from 1Password as a string, using the ambient
 * `OP_SERVICE_ACCOUNT_TOKEN` and the `op` on `PATH`.
 * @param reference - A 1Password `op://` reference.
 * @returns The value with a single trailing newline removed.
 * @throws {SecretReadError} When the token is unset or `op read` fails.
 */
export function secret(reference: string): string {
  const raw = Bun.env.OP_SERVICE_ACCOUNT_TOKEN?.trim()
  const token = raw === undefined || raw.length === 0 ? null : raw
  return createSecretReader({ token }).secret(reference)
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
