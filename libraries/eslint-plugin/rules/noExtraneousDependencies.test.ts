import * as parser from '@typescript-eslint/parser'
import { afterAll, describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { noExtraneousDependencies } from './noExtraneousDependencies'

const fixtureRoot = mkdtempSync(join(process.cwd(), 'tmp-no-extraneous-dependencies-'))

afterAll(() => {
  rmSync(fixtureRoot, { force: true, recursive: true })
})

const writeFixture = (path: string, contents: string): void => {
  const target = join(fixtureRoot, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

writeFixture('package.json', JSON.stringify({
  bundledDependencies: ['bundled-dep'],
  dependencies: {
    '@scope/scoped-dep': '1.0.0',
    'declared-dep': '1.0.0',
  },
  devDependencies: { 'dev-dep': '1.0.0' },
  name: 'fixture',
  optionalDependencies: { 'opt-dep': '1.0.0' },
  peerDependencies: { 'peer-dep': '1.0.0' },
  version: '1.0.0',
}))

writeFixture('nested/package.json', JSON.stringify({
  dependencies: { 'nested-dep': '1.0.0' },
  name: 'nested-fixture',
  version: '1.0.0',
}))

const filenameFor = (path: string): string => relative(process.cwd(), join(fixtureRoot, path))

const lint = (code: string, options?: Record<string, unknown>, filename = filenameFor('index.ts')) => {
  const linter = new Linter()
  return linter.verifyAndFix(code, [
    {
      files: ['**/*.ts'],
      languageOptions: {
        parser,
        parserOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
        },
      },
      plugins: {
        basis: {
          rules: {
            'no-extraneous-dependencies': noExtraneousDependencies,
          },
        },
      },
      rules: {
        'basis/no-extraneous-dependencies': options ? ['error', options] : 'error',
      },
    },
  ], { filename })
}

const messageIds = (
  code: string,
  options?: Record<string, unknown>,
  filename?: string,
): (string | undefined)[] => lint(code, options, filename).messages
  .filter(message => message.ruleId === 'basis/no-extraneous-dependencies')
  .map(message => message.messageId)

describe('noExtraneousDependencies', () => {
  test('allows dependencies declared in the nearest package.json', () => {
    expect(messageIds("import value from 'declared-dep'")).toEqual([])
    expect(messageIds("export { value } from 'declared-dep'")).toEqual([])
  })

  test('ignores imports of the package itself', () => {
    expect(messageIds("import value from 'fixture'")).toEqual([])
  })

  test('reports an undeclared bare import', () => {
    const messages = lint("import value from 'undeclared-dep'").messages
      .filter(message => message.ruleId === 'basis/no-extraneous-dependencies')

    expect(messages.map(message => message.messageId)).toEqual(['missingDependency'])
    expect(messages[0]?.message).toBe(
      "'undeclared-dep' should be listed in the project's dependencies. Run 'npm i -S undeclared-dep' to add it",
    )
  })

  test('handles scoped packages', () => {
    expect(messageIds("import value from '@scope/scoped-dep'")).toEqual([])
    expect(messageIds("import value from '@scope/undeclared'")).toEqual(['missingDependency'])
  })

  test('treats a subpath import as its parent package', () => {
    expect(messageIds("import value from 'declared-dep/sub/path'")).toEqual([])
    expect(messageIds("import value from '@scope/scoped-dep/sub/path'")).toEqual([])
    expect(messageIds("import value from 'undeclared-dep/sub/path'")).toEqual(['missingDependency'])
  })

  test('ignores relative imports and builtins', () => {
    expect(messageIds("import value from './local'")).toEqual([])
    expect(messageIds("import value from '../local'")).toEqual([])
    expect(messageIds("import path from 'node:path'")).toEqual([])
    expect(messageIds("import fs from 'fs'")).toEqual([])
    expect(messageIds("import { test } from 'bun:test'")).toEqual([])
  })

  test('ignores type-only imports and exports by default', () => {
    expect(messageIds("import type { Value } from 'undeclared-dep'")).toEqual([])
    expect(messageIds("import { type Value, type Other } from 'undeclared-dep'")).toEqual([])
    expect(messageIds("export type { Value } from 'undeclared-dep'")).toEqual([])
  })

  test('verifies type-only imports when requested', () => {
    expect(messageIds("import type { Value } from 'undeclared-dep'", { includeTypes: true }))
      .toEqual(['missingDependency'])
    expect(messageIds("import type { Value } from 'undeclared-dep'", { verifyTypeImports: true }))
      .toEqual(['missingDependency'])
  })

  test('allows devDependencies by default, matching the original rule', () => {
    expect(messageIds("import value from 'dev-dep'")).toEqual([])
  })

  test('reports devDependencies when devDependencies is false', () => {
    expect(messageIds("import value from 'dev-dep'", { devDependencies: false })).toEqual(['devDependency'])
    expect(messageIds("import value from 'dev-dep'", { devDependencies: true })).toEqual([])
  })

  test('reports optionalDependencies when optionalDependencies is false', () => {
    expect(messageIds("import value from 'opt-dep'")).toEqual([])
    expect(messageIds("import value from 'opt-dep'", { optionalDependencies: false })).toEqual(['optionalDependency'])
  })

  test('treats peer and bundled dependencies as available by default', () => {
    expect(messageIds("import value from 'peer-dep'")).toEqual([])
    expect(messageIds("import value from 'bundled-dep'")).toEqual([])
    expect(messageIds("import value from 'peer-dep'", { peerDependencies: false })).toEqual(['missingDependency'])
    expect(messageIds("import value from 'bundled-dep'", { bundledDependencies: false })).toEqual(['missingDependency'])
  })

  test('honors allowModules', () => {
    expect(messageIds("import value from 'allowed-dep'", { allowModules: ['allowed-dep'] })).toEqual([])

    const other = messageIds("import value from 'other-dep'", { allowModules: ['allowed-dep'] })
    expect(other).toEqual(['missingDependency'])
  })

  test('reads dependencies from packageDir instead of walking', () => {
    const packageDir = join(fixtureRoot, 'nested')

    expect(messageIds("import value from 'nested-dep'", { packageDir })).toEqual([])
    expect(messageIds("import value from 'declared-dep'", { packageDir })).toEqual(['missingDependency'])
  })

  test('walks up to the nearest package.json', () => {
    const nested = filenameFor('nested/index.ts')

    expect(messageIds("import value from 'nested-dep'", undefined, nested)).toEqual([])
    expect(messageIds("import value from 'declared-dep'", undefined, nested)).toEqual(['missingDependency'])
  })
})
