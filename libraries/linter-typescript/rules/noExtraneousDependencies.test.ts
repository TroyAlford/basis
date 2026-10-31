import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { lintWithBun } from './testUtils'

/*
 * The ESLint flat-config matcher only lints files below `process.cwd()`, so this
 * fixture must live inside the repository. It sits under the gitignored `tmp/`
 * and is owned by the run-scoped temp root, which the testing preload removes.
 */
const fixtureRoot = tempDirectory('no-extraneous-dependencies', join(process.cwd(), 'tmp'))

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

writeFixture('monorepo/package.json', JSON.stringify({
  name: 'monorepo-root',
  version: '1.0.0',
  workspaces: ['packages/*'],
}))

writeFixture('monorepo/packages/app/package.json', JSON.stringify({
  name: '@monorepo/app',
  version: '1.0.0',
}))

const lint = (code: string, filename = 'index.ts') => lintWithBun({
  code,
  filename,
  root: fixtureRoot,
  ruleExport: 'noExtraneousDependencies',
  ruleName: 'no-extraneous-dependencies',
  rulePath: join(import.meta.dir, 'noExtraneousDependencies.ts'),
})

const messageIds = (code: string, filename?: string): string[] => {
  const { report } = lint(code, filename)
  return report.includes('test/no-extraneous-dependencies') ? ['missingDependency'] : []
}

describe('noExtraneousDependencies', () => {
  test('allows dependencies declared in the nearest package.json', () => {
    expect(messageIds("import value from 'declared-dep'")).toEqual([])
    expect(messageIds("export { value } from 'declared-dep'")).toEqual([])
  })

  test('allows dependencies declared in any dependency field', () => {
    expect(messageIds("import value from 'dev-dep'")).toEqual([])
    expect(messageIds("import value from 'opt-dep'")).toEqual([])
    expect(messageIds("import value from 'peer-dep'")).toEqual([])
    expect(messageIds("import value from 'bundled-dep'")).toEqual([])
  })

  test('ignores imports of the package itself', () => {
    expect(messageIds("import value from 'fixture'")).toEqual([])
  })

  test('reports an undeclared bare import', () => {
    const { report } = lint("import value from 'undeclared-dep'")

    expect(report).toContain('test/no-extraneous-dependencies')
    expect(report).toContain("'undeclared-dep' should be listed in the project's dependencies")
    expect(report).toContain("Run 'npm i -S undeclared-dep' to add it")
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

  test('ignores type-only imports and exports', () => {
    expect(messageIds("import type { Value } from 'undeclared-dep'")).toEqual([])
    expect(messageIds("import { type Value, type Other } from 'undeclared-dep'")).toEqual([])
    expect(messageIds("export type { Value } from 'undeclared-dep'")).toEqual([])
  })

  test('walks up to the nearest package.json', () => {
    const nested = 'nested/index.ts'

    expect(messageIds("import value from 'nested-dep'", nested)).toEqual([])
    expect(messageIds("import value from 'declared-dep'", nested)).toEqual(['missingDependency'])
  })

  test('ignores a workspace importing the monorepo root package by name', () => {
    const app = 'monorepo/packages/app/index.ts'

    expect(messageIds("import value from 'monorepo-root/react'", app)).toEqual([])
    expect(messageIds("import value from 'undeclared-dep'", app)).toEqual(['missingDependency'])
  })
})
