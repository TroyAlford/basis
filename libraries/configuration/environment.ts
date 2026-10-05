/**
 * Typed configuration over the process environment.
 *
 * dotenv files are the source of deployment configuration. The standard
 * variants are loaded most-specific first — `.env.<mode>.local`, `.env.local`,
 * `.env.<mode>`, then `.env` — and a value already present in the process
 * environment always wins, so real environment variables override files. Code
 * reads values through an {@link Environment} rather than touching `Bun.env`
 * directly; settings are grouped by the topic that owns them, and computed
 * flags such as `ENABLED` keep enabling conditions in one place.
 */

import { parse } from 'dotenv'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Host peer-dependency checks belong to the environment surface: external
 * binaries are part of the host this configuration describes. `commands.ts`
 * remains the implementation; consumers reach the check through the
 * environment module rather than a second public entrypoint.
 */
export { requireCommands } from './commands'
export type { RequiredCommand } from './commands'

/** Error prefix shared by every configuration failure. */
const PREFIX = '[basis/configuration]'

/** Values treated as truthy by {@link Environment.boolean}. */
const TRUTHY = new Set(['1', 'on', 'true', 'yes'])

/** Values treated as falsy by {@link Environment.boolean}. */
const FALSY = new Set(['0', 'off', 'false', 'no'])

/**
 * The dotenv filenames for a mode, highest precedence first. `dotenv` never
 * overrides a value that is already set, so the first file that defines a key
 * wins.
 * @param mode - Runtime mode selecting the `.env.<mode>` variants.
 * @returns The ordered filenames.
 */
export function environmentFiles(mode: string): readonly string[] {
  return [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env']
}

/** Options accepted by {@link loadEnvironment}. */
export interface LoadEnvironmentOptions {
  /** Directory holding the dotenv files. Defaults to the current working directory. */
  directory?: string,
  /** Mode selecting the `.env.<mode>` files. Defaults to `NODE_ENV`, then `development`. */
  mode?: string,
  /** Overwrite variables already present in the process environment. Defaults to false. */
  override?: boolean,
}

/**
 * Load the standard dotenv files into the process environment, most-specific
 * first. A file that is absent is skipped, and — unless `override` is set — a
 * variable already present is never replaced.
 * @param options - Directory, mode, and override behavior.
 * @returns The dotenv files that were read, in precedence order.
 */
export function loadEnvironment(options: LoadEnvironmentOptions = {}): readonly string[] {
  const directory = options.directory ?? process.cwd()
  const mode = options.mode ?? process.env.NODE_ENV ?? 'development'
  const override = options.override ?? false

  const loaded: string[] = []
  for (const name of environmentFiles(mode)) {
    const path = join(directory, name)
    let source: string
    try {
      source = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    loaded.push(path)
    for (const [key, value] of Object.entries(parse(source))) {
      if (!override && process.env[key] !== undefined) continue
      process.env[key] = value
    }
  }
  return loaded
}

/**
 * A typed reader over the process environment, grouped by the topic that calls
 * it. Construct one after {@link loadEnvironment}; {@link Environment.load}
 * performs both steps.
 */
export class Environment {
  /**
   * Load the dotenv files and return a reader over the resulting environment.
   * @param options - Directory, mode, and override behavior.
   * @returns The environment reader.
   */
  static load(options: LoadEnvironmentOptions = {}): Environment {
    loadEnvironment(options)
    return new Environment()
  }

  /**
   * A trimmed, non-empty value, or `undefined` when the variable is unset or
   * blank.
   * @param key - Variable name.
   * @returns The value, or `undefined`.
   */
  value(key: string): string | undefined {
    const raw = Bun.env[key]?.trim()
    return raw === undefined || raw.length === 0 ? undefined : raw
  }

  /**
   * A string value, or the fallback when unset.
   * @param key - Variable name.
   * @param fallback - Value returned when the variable is unset.
   * @returns The value or the fallback.
   */
  string(key: string, fallback?: string): string | undefined {
    return this.value(key) ?? fallback
  }

  /**
   * A finite number parsed from the value, or the fallback when it is unset or
   * not numeric.
   * @param key - Variable name.
   * @param fallback - Value returned when the variable is unset or invalid.
   * @returns The parsed number or the fallback.
   */
  number(key: string, fallback?: number): number | undefined {
    const raw = this.value(key)
    if (raw === undefined) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  /**
   * A boolean parsed from the common tokens (`true`/`false`, `1`/`0`,
   * `yes`/`no`, `on`/`off`), or the fallback when unset or unrecognized.
   * @param key - Variable name.
   * @param fallback - Value returned when the variable is unset or unrecognized.
   * @returns The parsed boolean or the fallback.
   */
  boolean(key: string, fallback = false): boolean {
    const raw = this.value(key)?.toLowerCase()
    if (raw === undefined) return fallback
    if (TRUTHY.has(raw)) return true
    if (FALSY.has(raw)) return false
    return fallback
  }

  /**
   * A value that must be present.
   * @param key - Variable name.
   * @returns The value.
   * @throws {Error} When the variable is unset or blank.
   */
  required(key: string): string {
    const value = this.value(key)
    if (value === undefined) throw new Error(`${PREFIX} missing required environment variable "${key}"`)
    return value
  }

  /**
   * Whether every named variable is set — the computed `ENABLED` flag for a
   * topic. An empty list is enabled.
   * @param keys - Variable names required for the topic to be enabled.
   * @returns True when all of the variables are set.
   */
  enabled(...keys: string[]): boolean {
    return keys.every(key => this.value(key) !== undefined)
  }

  /**
   * The runtime mode. Defaults to `NODE_ENV`, then `development`.
   * @returns The runtime mode.
   */
  get mode(): string {
    return this.value('NODE_ENV') ?? 'development'
  }

  /**
   * Whether this is a non-production run.
   * @returns True outside production.
   */
  get development(): boolean {
    return this.mode !== 'production'
  }

  /**
   * Whether this is a production run.
   * @returns True in production.
   */
  get production(): boolean {
    return this.mode === 'production'
  }
}

/** A function that builds one topic's typed getters from an {@link Environment}. */
export type EnvironmentTopic = (env: Environment) => Record<string, unknown>

/**
 * Build a topic-grouped configuration from the environment. Each topic is a
 * named function that reads the variables it owns; computed `ENABLED` flags are
 * expressed with {@link Environment.enabled}.
 * @param topics - Map of topic name to getter builder.
 * @param options - dotenv loading options.
 * @returns The grouped configuration, keyed by topic.
 */
export function createConfiguration<const T extends Record<string, EnvironmentTopic>>(
  topics: T,
  options: LoadEnvironmentOptions = {},
): { [K in keyof T]: ReturnType<T[K]> } {
  const env = Environment.load(options)
  const configuration = {} as { [K in keyof T]: ReturnType<T[K]> }
  for (const [name, topic] of Object.entries(topics)) {
    configuration[name as keyof T] = topic(env) as ReturnType<T[keyof T]>
  }
  return configuration
}
