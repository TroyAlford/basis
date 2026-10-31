import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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
    const probe = Bun.spawnSync([process.execPath, 'lint', '--help'], {
      cwd: scratch,
      stderr: 'pipe',
      stdout: 'pipe',
    })
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
 * resolution without deferring to the consumer's script.
 * @param fix - Whether to apply the linter's fixes.
 * @param configPath - The ESLint config path to run.
 * @returns The child process exit code.
 */
export const runBunLint = (fix: boolean, configPath: string = eslintConfigPath()): number => {
  if (!requireBunLint()) return 1

  const scratch = mkdtempSync(join(tmpdir(), 'basis-lint-'))

  try {
    writeFileSync(
      join(scratch, 'package.json'),
      JSON.stringify({ name: 'basis-lint', private: true, type: 'module' }),
    )

    const result = Bun.spawnSync([
      process.execPath,
      'lint',
      '--cwd',
      process.cwd(),
      '--config',
      configPath,
      ...(fix ? ['--fix'] : []),
      '.',
    ], {
      cwd: scratch,
      stderr: 'inherit',
      stdin: 'inherit',
      stdout: 'inherit',
    })

    return result.exitCode
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }
}
