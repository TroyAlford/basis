import { Logger } from 'basis/logger'
import { run, runAsync } from 'basis/utilities'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { LintCache } from './lint-cache'
import { collectLintTargets, computeLintCacheKey, erroredLintTargets, hashFile, ignoredLintTargets, lintCachePath, pendingLintTargets, readLintCache, writeLintCache } from './lint-cache'

/** Flat ESLint config filenames Bun discovers automatically. */
const ESLINT_CONFIG_FILES = [
  'eslint.config.cjs',
  'eslint.config.cts',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.mts',
  'eslint.config.ts',
]

/**
 * The Basis package root.
 * @returns Absolute path to the Basis package root.
 */
const basisDir = (): string => join(import.meta.dir, '..')

/** Keep probe and lint process details out of the CLI's normal output. */
const silent = new Logger({ silent: true })

/**
 * Explains why the running Bun cannot run the built-in linter.
 *
 * The linter is not part of every stable Bun release yet, so probe the command
 * instead of assuming a version number is sufficient. The probe runs from a
 * scratch package with no `lint` script, so a zero exit code means Bun handled
 * the command itself.
 * @returns The actionable message, or null when the linter is available.
 */
export const bunLintUnsupportedReason = (): string | null => {
  const scratch = mkdtempSync(join(tmpdir(), 'basis-lint-probe-'))

  try {
    writeFileSync(
      join(scratch, 'package.json'),
      JSON.stringify({ name: 'basis-lint-probe', private: true, type: 'module' }),
    )
    const probe = run(process.execPath, ['lint', '--help'], { cwd: scratch, logger: silent })
    if (probe.exitCode === 0) return null
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }

  return `[basis] lint requires a Bun release with the built-in linter; found ${Bun.version}. ` +
    'Run `bun upgrade` and retry.'
}

/**
 * Reports whether the running Bun can run the built-in linter.
 * @returns Whether the linter is available.
 */
const requireBunLint = (): boolean => {
  const reason = bunLintUnsupportedReason()
  if (reason === null) return true
  process.stderr.write(`${reason}\n`)
  return false
}

/**
 * Finds the nearest ESLint flat config from a directory upward.
 * @param start - The directory to start at.
 * @returns Absolute path to the config file, or null when none exists.
 */
export const findEslintConfig = (start: string): string | null => {
  let directory = start
  for (;;) {
    for (const name of ESLINT_CONFIG_FILES) {
      const candidate = join(directory, name)
      if (existsSync(candidate)) return candidate
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

/**
 * Resolves the ESLint config a consumer or the Basis repository provides.
 * @returns Absolute path to the config file.
 */
const eslintConfigPath = (): string => (
  findEslintConfig(process.cwd()) ?? join(basisDir(), 'eslint.config.mjs')
)

/**
 * Runs Bun's built-in linter for the current project.
 *
 * Bun runs a package.json `lint` script instead of the built-in linter when one
 * exists. The command therefore runs from a scratch package with no `lint`
 * script and points `--cwd` at the real project, preserving config and ignore
 * resolution without deferring to the consumer's script. On repository-wide
 * runs, unchanged clean files are skipped using the local result cache.
 * @param fix - Whether to apply the linter's fixes.
 * @param configPath - The ESLint config path to run.
 * @param target - The path to lint, relative to the working directory.
 * @param cwd - Repository root. Defaults to the current working directory.
 * @returns The child process exit code.
 */
export const runBunLint = async (
  fix: boolean,
  configPath: string = eslintConfigPath(),
  target = '.',
  cwd = process.cwd(),
): Promise<number> => {
  if (!requireBunLint()) return 1

  const allTargets = target === '.' ? collectLintTargets(cwd) : [target]
  const cacheEligible = target === '.'
  if (allTargets.length === 0) return 0

  let cache: LintCache | null = null
  let cachePath = ''
  let targets = allTargets
  if (cacheEligible) {
    const key = await computeLintCacheKey({
      configPath,
      cwd,
      sourceRoots: [
        join(basisDir(), 'libraries', 'linter-typescript'),
        join(basisDir(), 'libraries', 'linter-support'),
      ],
    })
    if (key !== null) {
      cachePath = lintCachePath(cwd, key)
      cache = readLintCache(cachePath) ?? { files: {}, version: 1 }
      const ignored = new Set(cache.ignored ?? [])
      const checkableTargets = allTargets.filter(file => !ignored.has(file))
      const hashes = new Map(checkableTargets.map(file => [file, hashFile(join(cwd, file))]))
      targets = pendingLintTargets(checkableTargets, hashes, cache)
      if (targets.length === 0) {
        process.stdout.write(`[basis] lint cache: ${checkableTargets.length} files unchanged\n`)
        return 0
      }
    }
  }

  const scratch = mkdtempSync(join(tmpdir(), 'basis-lint-'))

  try {
    writeFileSync(
      join(scratch, 'package.json'),
      JSON.stringify({ name: 'basis-lint', private: true, type: 'module' }),
    )

    const result = await runAsync(process.execPath, [
      'lint',
      '--cwd',
      cwd,
      '--config',
      configPath,
      ...(fix ? ['--fix'] : []),
      ...targets,
    ], { cwd: scratch, logger: silent })
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)

    if (cache !== null) {
      const next: LintCache = { files: { ...cache.files }, version: 1 }
      const targetSet = new Set(allTargets)
      for (const file of Object.keys(next.files)) {
        if (!targetSet.has(file)) Reflect.deleteProperty(next.files, file)
      }
      const combined = `${result.stdout}${result.stderr}`
      const errored = result.exitCode === 0
        ? new Set<string>()
        : erroredLintTargets(combined, cwd, targets)
      const ignored = ignoredLintTargets(combined, cwd, targets)
      const nextIgnored = new Set(cache.ignored ?? [])
      for (const file of ignored) {
        nextIgnored.add(file)
        Reflect.deleteProperty(next.files, file)
      }
      for (const file of targets) {
        if (ignored.has(file)) continue
        nextIgnored.delete(file)
      }
      next.ignored = [...nextIgnored].filter(file => targetSet.has(file))
      const allFailed = result.exitCode !== 0 && errored.size === 0
      for (const file of targets) {
        if (ignored.has(file)) continue
        next.files[file] = {
          hash: hashFile(join(cwd, file)),
          status: result.exitCode === 0 || (!allFailed && !errored.has(file)) ? 'ok' : 'error',
        }
      }
      try {
        writeLintCache(cachePath, next)
      } catch {
        // The cache is an optimization; a read-only checkout must still lint.
      }
    }

    return result.exitCode
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }
}
