/**
 * Typed configuration over the process environment.
 *
 * dotenv files are the source of deployment configuration. On import the
 * standard variants load most-specific first — `.env.<mode>.local`, `.env.local`,
 * `.env.<mode>`, then `.env` — where `<mode>` is `NODE_ENV`, defaulting to
 * `development`. dotenv's own ordered `path` gives the precedence and never
 * overrides a value already present in the process environment, so real
 * environment variables win over files. There is no loading control plane:
 * consumers read values through an {@link Environment} and own the policy
 * (defaults, required keys, and enabling conditions) themselves.
 */

import { config } from 'dotenv'
import { join } from 'node:path'

/** Error prefix shared by every configuration failure. */
const PREFIX = '[basis/configuration]'

/** Values treated as truthy by {@link Environment.boolean}. */
const TRUTHY = new Set(['1', 'on', 'true', 'yes'])

/** Values treated as falsy by {@link Environment.boolean}. */
const FALSY = new Set(['0', 'off', 'false', 'no'])

/**
 * The mode selecting the `.env.<mode>` files, following the standard process
 * convention: `NODE_ENV`, then `development`.
 * @returns The selected mode.
 */
const currentMode = (): string => {
  const raw = Bun.env.NODE_ENV?.trim()
  return raw === undefined || raw.length === 0 ? 'development' : raw
}

/**
 * Load the standard dotenv files into the process environment using dotenv's
 * ordered `path`. Exposed to the workspace only as a private test seam for
 * selecting an alternate directory or mode; it is not part of the package
 * surface.
 * @param options - Directory and mode overrides for tests.
 * @param options.directory - Directory holding the dotenv files. Defaults to the current working directory.
 * @param options.mode - Mode selecting the `.env.<mode>` files. Defaults to `NODE_ENV`, then `development`.
 */
export function loadDotenv(options: { directory?: string, mode?: string } = {}): void {
  const directory = options.directory ?? process.cwd()
  const mode = options.mode ?? currentMode()

  config({
    path: [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env']
      .map(name => join(directory, name)),
    quiet: true,
  })
}

loadDotenv()

/**
 * A typed reader over the process environment. Values are trimmed, and a blank
 * value is treated as unset. Present-but-invalid values fail loudly rather than
 * silently falling back, so a typo in deployment configuration is never
 * mistaken for an intended default.
 */
export class Environment {
  /**
   * A string value, or the fallback when unset or blank.
   * @param key - Variable name.
   * @param fallback - Value returned when the variable is unset or blank.
   * @returns The value or the fallback.
   */
  string(key: string, fallback?: string): string | undefined {
    return read(key) ?? fallback
  }

  /**
   * A finite number, or the fallback when unset. A value that is present but
   * not numeric throws.
   * @param key - Variable name.
   * @param fallback - Value returned when the variable is unset.
   * @returns The parsed number or the fallback.
   * @throws {Error} When the variable is set but not a number.
   */
  number(key: string, fallback?: number): number | undefined {
    const raw = read(key)
    if (raw === undefined) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) throw new Error(`${PREFIX} environment variable "${key}" is not a number`)
    return parsed
  }

  /**
   * A boolean parsed from the common tokens (`true`/`false`, `1`/`0`,
   * `yes`/`no`, `on`/`off`), or the fallback when unset. A value that is present
   * but unrecognized throws.
   * @param key - Variable name.
   * @param fallback - Value returned when the variable is unset.
   * @returns The parsed boolean or the fallback.
   * @throws {Error} When the variable is set but not a recognized boolean.
   */
  boolean(key: string, fallback = false): boolean {
    const raw = read(key)?.toLowerCase()
    if (raw === undefined) return fallback
    if (TRUTHY.has(raw)) return true
    if (FALSY.has(raw)) return false
    throw new Error(`${PREFIX} environment variable "${key}" is not a boolean`)
  }

  /**
   * A value that must be present.
   * @param key - Variable name.
   * @returns The value.
   * @throws {Error} When the variable is unset or blank.
   */
  required(key: string): string {
    const value = read(key)
    if (value === undefined) throw new Error(`${PREFIX} missing required environment variable "${key}"`)
    return value
  }

  /**
   * Whether every named variable is set — the computed `ENABLED` flag a
   * consumer uses for a topic. An empty list is enabled.
   * @param keys - Variable names required for the topic to be enabled.
   * @returns True when all of the variables are set.
   */
  enabled(...keys: string[]): boolean {
    return keys.every(key => read(key) !== undefined)
  }
}

/**
 * A trimmed, non-empty value, or `undefined` when the variable is unset or
 * blank.
 * @param key - Variable name.
 * @returns The value, or `undefined`.
 */
function read(key: string): string | undefined {
  const raw = Bun.env[key]?.trim()
  return raw === undefined || raw.length === 0 ? undefined : raw
}
