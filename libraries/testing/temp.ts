import { existsSync, mkdirSync, mkdtempSync, rmdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * One run-scoped root per base directory, created on first use. The testing
 * preload (or a signal handler) removes every root once the run ends.
 */
const roots = new Map<string, string>()

/** Base directories the run created itself, removed again once empty. */
const createdBases = new Set<string>()

/**
 * The run-scoped root under a base directory, created on first use.
 * @param base - The directory the root is created in.
 * @returns The absolute root path.
 */
function runRoot(base: string): string {
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
 * Create a temp directory owned by the current test run.
 *
 * Every directory lives under a run-scoped root that the testing preload
 * removes on completion — and on `SIGINT`/`SIGTERM` — so a test that throws, is
 * interrupted, or forgets its own cleanup cannot leak a directory.
 *
 * The default base is the operating system temp directory. A base inside the
 * working tree (for example the gitignored `tmp/`) is available for the rare
 * fixture that must sit under the repository — the ESLint flat-config matcher
 * only lints files below `process.cwd()` — while still being owned and cleaned
 * up by the run.
 * @param prefix - A short label for the directory.
 * @param base - The directory the run root is created in. Defaults to `os.tmpdir()`.
 * @returns The absolute directory path.
 */
export function tempDirectory(prefix: string, base: string = tmpdir()): string {
  return mkdtempSync(join(runRoot(base), `${prefix}-`))
}

/**
 * Remove every run-scoped temp root and all directories under them. Idempotent.
 */
export function cleanupTempDirectories(): void {
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
