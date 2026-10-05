/**
 * Install-time validation of a consumer's declared non-npm host dependencies.
 *
 * Some capabilities the host must provide are not npm packages — `docker`,
 * `nginx`, `op`, `lego` — and cannot be installed by `bun install`. A consumer
 * declares the ones it needs as static deployment metadata in its own root
 * `package.json`:
 *
 * ```json
 * { "basis": { "hostDependencies": ["docker", "nginx", "op", "lego"] } }
 * ```
 *
 * Basis's trusted install hook reads that declaration and fails `bun install`
 * loudly, naming every capability that does not resolve on `PATH` or is
 * declared incorrectly, so a host that cannot run the application never
 * completes an install that looks successful. This is package metadata, not an
 * imperative API: application source never calls it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Error prefix shared by host-dependency failures. */
const PREFIX = '[basis]'

/** Top-level manifest field carrying Basis's static deployment metadata. */
const BASIS_FIELD = 'basis'

/** Resolve a command name to an absolute path, or `null` when it is absent. */
export type HostCommandResolver = (command: string) => string | null

/** Outcome of validating a consumer's declared host dependencies. */
export interface HostDependencyCheck {
  /** Declarations that are not non-empty strings. */
  readonly broken: readonly string[],
  /** Declared capabilities that do not resolve on `PATH`. */
  readonly missing: readonly string[],
  /** Declared capabilities that resolve on `PATH`. */
  readonly resolved: readonly string[],
}

/**
 * A declaration rendered for a failure message.
 * @param entry - Declared value.
 * @returns A stable, single-line description.
 */
function describe(entry: unknown): string {
  return JSON.stringify(entry) ?? String(entry)
}

/**
 * Read the declared host dependencies from a consumer's root `package.json`. A
 * missing declaration is an empty list; a malformed `basis` field or a
 * non-array `hostDependencies` fails loudly.
 * @param rootDir - Absolute path to the consumer project root.
 * @returns The declared entries, unvalidated.
 * @throws {Error} When the manifest or the declaration is malformed.
 */
export function readHostDependencies(rootDir: string): unknown[] {
  const manifestPath = join(rootDir, 'package.json')
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${PREFIX} could not read ${manifestPath} to check host dependencies: ${detail}`, { cause: error })
  }

  const basis = manifest[BASIS_FIELD]
  if (basis === undefined) return []
  if (typeof basis !== 'object' || basis === null || Array.isArray(basis)) {
    throw new Error(`${PREFIX} "${BASIS_FIELD}" in ${manifestPath} must be an object`)
  }

  const declared = (basis as Record<string, unknown>).hostDependencies
  if (declared === undefined) return []
  if (!Array.isArray(declared)) {
    throw new Error(`${PREFIX} "${BASIS_FIELD}.hostDependencies" in ${manifestPath} must be an array`)
  }
  return declared
}

/**
 * Resolve every declared host capability on `PATH`, splitting the resolved from
 * the missing and the malformed. Never throws, so a caller can report all
 * problems at once.
 * @param declared - Declared entries, typically from {@link readHostDependencies}.
 * @param resolve - Resolver used to locate a capability. Defaults to `Bun.which`.
 * @returns The broken, missing, and resolved declarations.
 */
export function checkHostDependencies(
  declared: readonly unknown[],
  resolve: HostCommandResolver = Bun.which,
): HostDependencyCheck {
  const broken: string[] = []
  const missing: string[] = []
  const resolved: string[] = []

  for (const entry of declared) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      broken.push(describe(entry))
      continue
    }
    const name = entry.trim()
    if (resolve(name) === null) missing.push(name)
    else resolved.push(name)
  }

  return { broken, missing, resolved }
}

/**
 * Fail loudly unless every declared host dependency resolves on `PATH`.
 * @param rootDir - Absolute path to the consumer project root.
 * @param options - Resolver override, used by tests.
 * @param options.resolve - Resolver used to locate a capability. Defaults to `Bun.which`.
 * @returns The check outcome when every declaration is satisfied.
 * @throws {Error} Naming every missing and malformed declaration.
 */
export function requireHostDependencies(
  rootDir: string,
  options: { resolve?: HostCommandResolver } = {},
): HostDependencyCheck {
  const check = checkHostDependencies(readHostDependencies(rootDir), options.resolve ?? Bun.which)
  if (check.missing.length === 0 && check.broken.length === 0) return check

  const problems: string[] = []
  if (check.missing.length > 0) problems.push(`not found on PATH: ${check.missing.join(', ')}`)
  if (check.broken.length > 0) problems.push(`invalid declaration(s): ${check.broken.join(', ')}`)

  throw new Error(
    `${PREFIX} declared host dependencies are unsatisfied — ${problems.join('; ')}.\n` +
    'Install the missing capabilities on the host, or remove them from ' +
    `"${BASIS_FIELD}.hostDependencies" in package.json.`,
  )
}
