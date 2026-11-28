import { tempDirectory } from 'basis/testing'
import { run as runProcess } from 'basis/utilities'
import { describe, expect, test } from 'bun:test'
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CLI = join(import.meta.dir, 'cli.ts')
const TYPESCRIPT_LINTER = join(import.meta.dir, '..', 'libraries', 'linter-typescript', 'index.ts')

const DIRTY = `
import { join } from 'node:path'
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
`.trimStart()

const FIXED = `
import { existsSync } from 'node:fs'
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
`.trimStart()

const DIRTY_MD = `
# Notes


A paragraph that
wraps across lines.
`.trimStart()

const FIXED_MD = `
# Notes

A paragraph that wraps across lines.
`.trimStart()

const ARCHITECTURE_VIOLATION = `
import { useState } from 'react'

export const Hello = ({ name }: { name: string }) => {
  const [value] = useState(0)
  return <p>{name}{value}</p>
}
`.trimStart()

const ARCHITECTURE_FIXED = `
import { Component } from 'basis/react'

export class Hello extends Component<{ name: string }> {
  static displayName = 'Hello'

  content() {
    return <p>{this.props.name}</p>
  }
}
`.trimStart()

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
 * Writes a consumer tsconfig so `basis lint` can typecheck the fixture.
 * @param dir The fixture directory.
 */
const writeTsconfig = (dir: string): void => {
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      paths: {
        'basis/*': [join(import.meta.dir, '..', 'consumer', '*.ts')],
        'basis/react/icons': [join(import.meta.dir, '..', 'consumer', 'react-icons.ts')],
        'basis/testing/bun': [join(import.meta.dir, '..', 'consumer', 'testing-bun.ts')],
      },
    },
    exclude: ['node_modules'],
    extends: join(import.meta.dir, '..', 'consumer', 'tsconfig', 'react.json'),
    include: ['**/*.ts', '**/*.tsx'],
  }, null, 2))
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
  const dir = tempDirectory('basis-cli')
  /*
   * ESLint resolves its default formatter (and the plugin stack) through a
   * consumer node_modules; reuse the workspace install rather than a copy.
   */
  symlinkSync(join(import.meta.dir, '..', 'node_modules'), join(dir, 'node_modules'), 'dir')
  if (config) writeFileSync(join(dir, 'eslint.config.mjs'), `export { default } from '${TYPESCRIPT_LINTER}'\n`)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }))
  writeTsconfig(dir)
  const target = join(dir, 'fixture.ts')
  writeFileSync(target, DIRTY)
  const markdown = join(dir, 'notes.md')
  writeFileSync(markdown, DIRTY_MD)
  return { dir, markdown, target }
}

/**
 * Creates a clean consumer fixture containing only package metadata and an
 * optional ESLint config, so an architecture test is not diluted by the dirty
 * fixture files used by the lint/format suite.
 * @param options Fixture options.
 * @param options.config Optional repository ESLint config source.
 * @returns The fixture directory.
 */
const makeComponentFixture = (options: { config?: string } = {}): string => {
  const { config } = options
  const dir = tempDirectory('basis-cli')
  symlinkSync(join(import.meta.dir, '..', 'node_modules'), join(dir, 'node_modules'), 'dir')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'fixture',
    peerDependencies: {
      'basis': '^1.0.0',
      'react': '^19.0.0',
      'react-dom': '^19.0.0',
    },
    type: 'module',
  }))
  writeTsconfig(dir)
  if (config) writeFileSync(join(dir, 'eslint.config.mjs'), config)
  return dir
}

/**
 * Runs a Basis CLI command in a fixture directory.
 * @param args Arguments for the CLI, including the command.
 * @param cwd Working directory for the CLI.
 * @returns The process exit code.
 */
const run = (args: string[], cwd: string): number => (
  runProcess(process.execPath, [CLI, ...args], { cwd }).exitCode
)

/** CLI fixtures install a plugin stack, so their lint passes exceed Bun's default test timeout. */
const CLI_TIMEOUT = 15_000

describe('basis lint and format', () => {
  test('leaves dirty files untouched without formatting', () => {
    const { dir, markdown, target } = makeFixture()
    try {
      expect(run(['lint'], dir)).not.toBe(0)
      expect(readFileSync(target, 'utf8').trim()).toBe(DIRTY.trim())
      expect(readFileSync(markdown, 'utf8').trim()).toBe(DIRTY_MD.trim())
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)

  test('applies every fixable rule across surfaces in a single run', () => {
    const { dir, markdown, target } = makeFixture()
    try {
      expect(run(['format'], dir)).toBe(0)
      expect(readFileSync(target, 'utf8').trim()).toBe(FIXED.trim())
      expect(readFileSync(markdown, 'utf8').trim()).toBe(FIXED_MD.trim())

      // A second, report-only run proves the first pass fully converged.
      expect(run(['lint'], dir)).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)

  test('lints and formats with no repository ESLint config', () => {
    const { dir, markdown, target } = makeFixture({ config: false })
    try {
      expect(run(['lint'], dir)).not.toBe(0)
      expect(run(['format'], dir)).toBe(0)
      expect(readFileSync(target, 'utf8').trim()).toBe(FIXED.trim())
      expect(readFileSync(markdown, 'utf8').trim()).toBe(FIXED_MD.trim())

      // A second, report-only run proves the fallback config fully converged.
      expect(run(['lint'], dir)).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)
})

describe('basis lint style scope', () => {
  test('does not enforce architecture', () => {
    const dir = makeComponentFixture()
    const component = join(dir, 'Hello.tsx')
    try {
      writeFileSync(component, ARCHITECTURE_VIOLATION)
      expect(run(['lint'], dir)).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)

  test('does not enforce process execution', () => {
    const dir = makeComponentFixture()
    const launcher = join(dir, 'launcher.ts')
    try {
      writeFileSync(launcher, 'export const start = (): unknown => Bun.spawn([\'bun\', \'./server.ts\'])\n')
      expect(run(['lint'], dir)).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)
})

describe('basis compliance', () => {
  test('reports architecture violations without a repository ESLint config', () => {
    const dir = makeComponentFixture()
    const component = join(dir, 'Hello.tsx')
    try {
      writeFileSync(component, ARCHITECTURE_VIOLATION)
      expect(run(['compliance'], dir)).not.toBe(0)

      writeFileSync(component, ARCHITECTURE_FIXED)
      expect(run(['compliance'], dir)).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)

  test('ignores test and fixture source by default', () => {
    const dir = makeComponentFixture()
    try {
      writeFileSync(join(dir, 'Hello.test.tsx'), ARCHITECTURE_VIOLATION)
      expect(run(['compliance'], dir)).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)

  test('reports direct process execution in application source', () => {
    const dir = makeComponentFixture()
    const launcher = join(dir, 'launcher.ts')
    try {
      writeFileSync(launcher, 'export const start = (): unknown => Bun.spawn([\'bun\', \'./server.ts\'])\n')
      expect(run(['compliance'], dir)).not.toBe(0)
      expect(run(['lint'], dir)).toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)

  test('reports a manual test server through the allowed runner', () => {
    const dir = makeComponentFixture()
    const launcher = join(dir, 'server.test.ts')
    try {
      writeFileSync(launcher, [
        'import { runAsync } from \'basis/utilities\'',
        'await runAsync(\'bun\', [\'run\', \'start\'])',
      ].join('\n'))
      expect(run(['compliance'], dir)).not.toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)

  test('stays authoritative when the repository config disables the rule', () => {
    const dir = makeComponentFixture({
      config: `
import { createConfig } from '${join(import.meta.dir, 'eslint.ts')}'
export default createConfig({
  overrides: [{ files: ['**/*.tsx'], rules: { '@basis/component-architecture': 'off' } }],
})

      `.trim(),
    })
    try {
      writeFileSync(join(dir, 'Hello.tsx'), ARCHITECTURE_VIOLATION)
      expect(run(['compliance'], dir)).not.toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)
})

describe('basis check removal', () => {
  test('rejects the obsolete check command', () => {
    const dir = makeComponentFixture()
    try {
      expect(run(['check'], dir)).not.toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)
})

describe('basis db arguments', () => {
  test('requires a known database subcommand', () => {
    const dir = makeComponentFixture()
    try {
      expect(run(['db'], dir)).not.toBe(0)
      expect(run(['db', 'unknown'], dir)).not.toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)

  test('requires arguments before loading the application graph', () => {
    const dir = makeComponentFixture()
    try {
      expect(run(['db', 'restore'], dir)).not.toBe(0)
      expect(run(['db', 'restore', '--image', 'postgres:17-alpine'], dir)).not.toBe(0)
      expect(run(['db', 'upgrade'], dir)).not.toBe(0)
      expect(run(['db', 'rollback'], dir)).not.toBe(0)
      expect(run(['db', 'rollback', '.basis/backups/source.dump', '--image'], dir)).not.toBe(0)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }, CLI_TIMEOUT)
})
