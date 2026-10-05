import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as configuration from './index'

/** Marker variable the import-side-effect fixtures write into `.env`. */
const SENTINEL = 'BASIS_CONFIG_DOTENV_SENTINEL'

/** Absolute import specifier for this package's barrel. */
const ENTRY = JSON.stringify(join(import.meta.dir, 'index.ts'))

/** Temporary directories to remove after each test. */
const directories: string[] = []

/**
 * Create a directory whose `.env` sets the sentinel variable.
 * @returns The fixture directory.
 */
function dotenvFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'basis-config-import-'))
  directories.push(directory)
  writeFileSync(join(directory, '.env'), `${SENTINEL}=loaded\n`)
  return directory
}

/**
 * Run an in-process script from a given working directory.
 * @param cwd - Working directory for the child.
 * @param script - The script source.
 * @returns The child's trimmed standard output.
 */
function runScript(cwd: string, script: string): string {
  const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', script], {
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  if (result.exitCode !== 0) throw new Error(`script failed: ${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('basis/configuration public surface', () => {
  test('exposes only the supported primitives', () => {
    expect(Object.keys(configuration).sort()).toEqual([
      'Environment',
      'run',
      'secret',
    ])
  })
})

describe('import side effects', () => {
  test('importing and using run alone does not load dotenv files', () => {
    const directory = dotenvFixture()
    const script = [
      `import { run } from ${ENTRY}`,
      "run('true', [], { logger: { error() {}, info() {} } })",
      `process.stdout.write(process.env.${SENTINEL} ?? 'unset')`,
    ].join('; ')

    expect(runScript(directory, script)).toBe('unset')
  })

  test('importing secret alone does not load dotenv files', () => {
    const directory = dotenvFixture()
    const script = [
      `import { secret } from ${ENTRY}`,
      `process.stdout.write(process.env.${SENTINEL} ?? 'unset')`,
    ].join('; ')

    expect(runScript(directory, script)).toBe('unset')
  })

  test('constructing an Environment loads the standard dotenv files', () => {
    const directory = dotenvFixture()
    const script = [
      `import { Environment } from ${ENTRY}`,
      'new Environment()',
      `process.stdout.write(process.env.${SENTINEL} ?? 'unset')`,
    ].join('; ')

    expect(runScript(directory, script)).toBe('loaded')
  })
})
