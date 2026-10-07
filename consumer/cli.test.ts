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

const DIRTY_MD = `# Notes


A paragraph that
wraps across lines.
`

const FIXED_MD = `# Notes

A paragraph that wraps across lines.
`

/** A throwaway consumer fixture spanning every lint surface. */
interface Fixture {
  /** The fixture directory. */
  dir: string,
  /** Path to the fixture Markdown document. */
  markdown: string,
  /** Path to the fixture TypeScript module. */
  target: string,
}

/**
 * Creates a throwaway consumer. The fixture deliberately breaks every fixable
 * rule the report named. By default it carries its own ESLint config; pass
 * `config: false` to exercise the zero-config CLI path.
 * @param options Fixture options.
 * @param options.config Whether to write the repository's own ESLint config.
 * @returns The fixture directory and its lint targets.
 */
const makeFixture = (options: { config?: boolean } = {}): Fixture => {
  const { config = true } = options
  const dir = mkdtempSync(join(tmpdir(), 'basis-cli-'))
  /*
   * ESLint resolves its default formatter (and the plugin stack) through a
   * consumer node_modules; reuse the workspace install rather than a copy.
   */
  symlinkSync(join(import.meta.dir, '..', 'node_modules'), join(dir, 'node_modules'), 'dir')
  if (config) writeFileSync(join(dir, 'eslint.config.mjs'), `export { default } from '${ESLINT_PLUGIN}'\n`)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }))
  const target = join(dir, 'fixture.ts')
  writeFileSync(target, DIRTY)
  const markdown = join(dir, 'notes.md')
  writeFileSync(markdown, DIRTY_MD)
  return { dir, markdown, target }
}

/**
 * Runs a Basis CLI command in a fixture directory.
 * @param args Arguments for the CLI, including the command.
 * @param cwd Working directory for the CLI.
 * @returns The process exit code.
 */
const run = (args: string[], cwd: string): number => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, CLI, ...args],
    cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  return result.exitCode
}

describe('basis lint and format', () => {
  test('leaves dirty files untouched without formatting', () => {
    const { dir, markdown, target } = makeFixture()
    try {
      expect(run(['lint'], dir)).not.toBe(0)
      expect(readFileSync(target, 'utf8')).toBe(DIRTY)
      expect(readFileSync(markdown, 'utf8')).toBe(DIRTY_MD)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('applies every fixable rule across surfaces in a single run', () => {
    const { dir, markdown, target } = makeFixture()
    try {
      expect(run(['format'], dir)).toBe(0)
      expect(readFileSync(target, 'utf8')).toBe(FIXED)
      expect(readFileSync(markdown, 'utf8')).toBe(FIXED_MD)

      // A second, report-only run proves the first pass fully converged.
      expect(run(['lint'], dir)).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test('lints and formats with no repository ESLint config', () => {
    const { dir, markdown, target } = makeFixture({ config: false })
    try {
      expect(run(['lint'], dir)).not.toBe(0)
      expect(run(['format'], dir)).toBe(0)
      expect(readFileSync(target, 'utf8')).toBe(FIXED)
      expect(readFileSync(markdown, 'utf8')).toBe(FIXED_MD)

      // A second, report-only run proves the fallback config fully converged.
      expect(run(['lint'], dir)).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})
