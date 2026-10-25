import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
 * Reports whether the running Bun can run the built-in linter.
 *
 * The linter is not part of every stable Bun release yet, so probe the command
 * instead of assuming a version number is sufficient.
 * @returns Whether the linter is available.
 */
export const requireBunLint = (): boolean => {
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
    if (probe.exitCode === 0 && probe.stdout.toString().includes('Usage: bun lint')) return true
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }

  process.stderr.write(
    `[basis] lint requires a Bun release with the built-in linter; found ${Bun.version}. ` +
    'Run `bun upgrade` and retry.\n',
  )
  return false
}

/**
 * Resolves the ESLint config a consumer or the Basis repository provides.
 * @returns Absolute path to the config file.
 */
const eslintConfigPath = (): string => (
  ESLINT_CONFIG_FILES
    .map(name => join(process.cwd(), name))
    .find(path => existsSync(path)) ?? join(basisDir(), 'eslint.config.mjs')
)

/**
 * Runs Bun's built-in linter for the current project.
 *
 * Bun runs a package.json `lint` script instead of the built-in linter when one
 * exists. The command therefore runs from a scratch package with no `lint`
 * script and points `--cwd` at the real project, preserving config and ignore
 * resolution without deferring to the consumer's script.
 * @param fix - Whether to apply the linter's fixes.
 * @returns The child process exit code.
 */
export const runBunLint = (fix: boolean): number => {
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
      eslintConfigPath(),
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
