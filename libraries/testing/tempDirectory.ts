import { existsSync, mkdirSync, mkdtempSync, rmdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Temp-directory environment variables, in the order `os.tmpdir()` consults
 * them. Redirecting all three keeps `os.tmpdir()` — and therefore `mkdtemp`,
 * and any dependency or spawned child that uses either — inside the run root.
 */
const TEMP_ENV_KEYS = ['TMPDIR', 'TMP', 'TEMP'] as const

/** One run-scoped root per base directory. */
const roots = new Map<string, string>()

/** Base directories the run created itself, removed again once empty. */
const createdBases = new Set<string>()

/** The redirected run root, or `null` before {@link isolateTempDirectories}. */
let isolated: string | null = null

/** The temp-directory environment values to restore when the run ends. */
const savedEnv = new Map<string, string | undefined>()

/**
 * The run-scoped root under a base directory, created on first use.
 * @param base - The directory the root is created in.
 * @returns The absolute root path.
 */
function rootFor(base: string): string {
  const existing = roots.get(base)
  if (existing) return existing
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true })
    createdBases.add(base)
  }
  const created = mkdtempSync(join(base, 'basis-run-'))
  roots.set(base, created)
  return created
}

/**
 * Point the process temp directory at a run-scoped root.
 *
 * The testing preload calls this before the suite, so `os.tmpdir()` — and every
 * `mkdtemp` call, dependency, or spawned child that resolves through it — writes
 * inside one root that {@link cleanupTempDirectories} removes when the run ends.
 * Calling it again is a no-op.
 * @returns The absolute run root.
 */
export function isolateTempDirectories(): string {
  if (isolated) return isolated
  const root = rootFor(tmpdir())
  for (const key of TEMP_ENV_KEYS) {
    savedEnv.set(key, process.env[key])
    process.env[key] = root
  }
  isolated = root
  return root
}

/**
 * Create a temp directory owned by the current test run.
 *
 * The directory lives under the isolated temp root the preload removes on
 * completion — and on `SIGINT`/`SIGTERM` — so a test that throws, is interrupted,
 * or forgets its own cleanup cannot leak it. It is sugar over the isolated
 * `os.tmpdir()`: plain `mkdtemp(tmpdir())` is captured the same way.
 * @param prefix - A short label for the directory.
 * @param base - Place the run root under this directory instead of the isolated
 * temp root. Needed only for a fixture a tool resolves below the working
 * directory (the ESLint flat-config matcher, for example).
 * @returns The absolute directory path.
 */
export function tempDirectory(prefix: string, base?: string): string {
  const root = base ? rootFor(base) : isolateTempDirectories()
  return mkdtempSync(join(root, `${prefix}-`))
}

/**
 * Remove every run-scoped temp root and restore the temp environment.
 * Idempotent.
 */
export function cleanupTempDirectories(): void {
  if (roots.size === 0 && savedEnv.size === 0) return
  for (const [key, value] of savedEnv) {
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
  savedEnv.clear()
  isolated = null
  for (const root of roots.values()) rmSync(root, { force: true, recursive: true })
  roots.clear()
  for (const base of createdBases) {
    try {
      rmdirSync(base)
    } catch {
      /* The base still holds something else; leave it. */
    }
  }
  createdBases.clear()
}
