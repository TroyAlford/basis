/**
 * Install-time validation of a consumer's declared non-npm host dependencies.
 *
 * Some capabilities the host must provide are not npm packages — `docker`,
 * `nginx`, `pm2`, `op`, `lego`, `opencode` — and cannot be installed by
 * `bun install`. A consumer declares the ones it needs as static deployment
 * metadata in its own root `package.json`:
 *
 * ```json
 * { "basis": { "hostDependencies": ["docker", "nginx", "op", "lego"] } }
 * ```
 *
 * Basis owns the verification policy. A declared capability must resolve on
 * `PATH`, and for the known capabilities Basis also runs the boring version
 * command to prove the binary is runnable, not merely present. A capability
 * that is missing, present-but-broken, or declared incorrectly fails
 * `bun install` loudly, naming it. This is package metadata, not an imperative
 * API: application source never calls it, and optional capabilities are simply
 * left out of the declaration rather than configured.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from '../libraries/configuration/run'
import { Logger } from '../libraries/utilities'

/** Error prefix shared by host-dependency failures. */
const PREFIX = '[basis]'

/** Top-level manifest field carrying Basis's static deployment metadata. */
const BASIS_FIELD = 'basis'

/** How long a capability's version probe may run before it is killed. */
const PROBE_TIMEOUT_MS = 10_000

/** Logger that stays quiet; probe output is not install output. */
const silent = new Logger({ silent: true })

/**
 * The version command Basis runs to prove a known capability is runnable. An
 * unknown declared name falls back to presence on `PATH` alone.
 */
const PROBES: Readonly<Record<string, readonly string[]>> = {
  docker: ['--version'],
  lego: ['--version'],
  nginx: ['-v'],
  op: ['--version'],
  opencode: ['--version'],
  pm2: ['--version'],
}

/** Resolve a command name to an absolute path, or `null` when it is absent. */
export type HostCommandResolver = (command: string) => string | null

/** Outcome of running a capability's version command. */
export interface HostProbeResult {
  /** Process exit code; zero means runnable. */
  readonly exitCode: number,
}

/** Run a capability's version command; injectable for tests. */
export type HostProbe = (command: string, args: readonly string[]) => HostProbeResult

/** Injectable resolution and probing, used by tests. */
export interface HostDependencyOptions {
  /** Prober used for known capabilities. Defaults to the shared runner. */
  readonly probe?: HostProbe,
  /** Resolver used to locate capabilities. Defaults to `Bun.which`. */
  readonly resolve?: HostCommandResolver,
}

/** Outcome of validating a consumer's declared host dependencies. */
export interface HostDependencyCheck {
  /** Declared capabilities that resolve on `PATH` but are not runnable. */
  readonly broken: readonly string[],
  /** Declarations that are not non-empty strings. */
  readonly invalid: readonly string[],
  /** Declared capabilities that do not resolve on `PATH`. */
  readonly missing: readonly string[],
  /** Declared capabilities that pass verification. */
  readonly resolved: readonly string[],
}

/**
 * The default prober, using the shared bounded runner.
 * @param command - Capability to run.
 * @param args - Version arguments.
 * @returns The exit code.
 */
const defaultProbe: HostProbe = (command, args) => run(command, args, {
  logger: silent,
  timeoutMs: PROBE_TIMEOUT_MS,
})

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
 * Verify every declared host capability, splitting the invalid declarations,
 * the missing commands, the present-but-broken known capabilities, and the
 * resolved ones. Never throws, so a caller can report every problem at once.
 * @param declared - Declared entries, typically from {@link readHostDependencies}.
 * @param options - Resolution and probing overrides.
 * @returns The broken, invalid, missing, and resolved declarations.
 */
export function checkHostDependencies(
  declared: readonly unknown[],
  options: HostDependencyOptions = {},
): HostDependencyCheck {
  const probe = options.probe ?? defaultProbe
  const resolve = options.resolve ?? Bun.which
  const broken: string[] = []
  const invalid: string[] = []
  const missing: string[] = []
  const resolved: string[] = []

  for (const entry of declared) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      invalid.push(describe(entry))
      continue
    }

    const name = entry.trim()
    if (resolve(name) === null) {
      missing.push(name)
      continue
    }

    const args = PROBES[name]
    if (args === undefined || probe(name, args).exitCode === 0) resolved.push(name)
    else broken.push(name)
  }

  return { broken, invalid, missing, resolved }
}

/**
 * Fail loudly unless every declared host dependency passes verification.
 * @param rootDir - Absolute path to the consumer project root.
 * @param options - Resolution and probing overrides, used by tests.
 * @returns The check outcome when every declaration is satisfied.
 * @throws {Error} Naming every missing, broken, and invalid declaration.
 */
export function requireHostDependencies(
  rootDir: string,
  options: HostDependencyOptions = {},
): HostDependencyCheck {
  const check = checkHostDependencies(readHostDependencies(rootDir), options)

  const problems: string[] = []
  if (check.missing.length > 0) problems.push(`not found on PATH: ${check.missing.join(', ')}`)
  if (check.broken.length > 0) problems.push(`present but not runnable: ${check.broken.join(', ')}`)
  if (check.invalid.length > 0) problems.push(`invalid declaration(s): ${check.invalid.join(', ')}`)
  if (problems.length === 0) return check

  throw new Error(
    `${PREFIX} declared host dependencies are unsatisfied — ${problems.join('; ')}.\n` +
    'Install the missing capabilities on the host, or remove them from ' +
    `"${BASIS_FIELD}.hostDependencies" in package.json.`,
  )
}
