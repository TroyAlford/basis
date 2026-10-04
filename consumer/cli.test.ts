import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dir, 'cli.ts')
const ESLINT_PLUGIN = join(import.meta.dir, '..', 'libraries', 'eslint-plugin', 'index.ts')

const DIRTY = `import { join } from 'node:path'
import { existsSync } from 'node:fs'

// first
// second
export interface Widget {
  zeta: string,
  alpha: string,
}

export const config = { zeta: 1, alpha: 2 }

export const greeting = "hello"

export const pick = (): string => join('a', 'b')
export const present = (): boolean => existsSync('x')
`

const FIXED = `import { existsSync } from 'node:fs'
import { join } from 'node:path'

/*
 * first
 * second
 */
export interface Widget {
  alpha: string,
  zeta: string,
}

export const config = { alpha: 2, zeta: 1 }

export const greeting = 'hello'

export const pick = (): string => join('a', 'b')
export const present = (): boolean => existsSync('x')
`

/**
 * Creates a throwaway consumer whose ESLint config is the Basis preset. The
 * fixture deliberately breaks every fixable rule the report named.
 * @returns The fixture directory and its lint target path.
 */
const makeFixture = (): { dir: string, target: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'basis-cli-'))
  /*
   * ESLint resolves its default formatter (and the plugin stack) through a
   * consumer node_modules; reuse the workspace install rather than a copy.
   */
  symlinkSync(join(import.meta.dir, '..', 'node_modules'), join(dir, 'node_modules'), 'dir')
  writeFileSync(join(dir, 'eslint.config.mjs'), `export { default } from '${ESLINT_PLUGIN}'\n`)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }))
  const target = join(dir, 'fixture.ts')
  writeFileSync(target, DIRTY)
  return { dir, target }
}

/**
 * Runs the Basis CLI in a fixture directory.
 * @param args Arguments after the CLI's `lint` subcommand.
 * @param cwd Working directory for the CLI.
 * @returns The process exit code.
 */
const runLint = (args: string[], cwd: string): number => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, CLI, 'lint', ...args],
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  return result.exitCode
}

describe('basis lint --fix', () => {
  test('leaves a dirty file untouched without --fix', () => {
    const { dir, target } = makeFixture()
    try {
      expect(runLint([], dir)).not.toBe(0)
      expect(readFileSync(target, 'utf8')).toBe(DIRTY)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('applies every fixable rule in a single run', () => {
    const { dir, target } = makeFixture()
    try {
      expect(runLint(['--fix'], dir)).toBe(0)
      expect(readFileSync(target, 'utf8')).toBe(FIXED)

      // A second, report-only run proves the first pass fully converged.
      expect(runLint([], dir)).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})
