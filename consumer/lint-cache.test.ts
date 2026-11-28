import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectLintTargets, computeLintCacheKey, erroredLintTargets, hashContent, pendingLintTargets } from './lint-cache'

describe('lint cache targets', () => {
  test('collects source files while skipping generated and dependency trees', () => {
    const root = tempDirectory('basis-targets')
    try {
      mkdirSync(join(root, 'src'), { recursive: true })
      mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
      mkdirSync(join(root, 'generated'), { recursive: true })
      mkdirSync(join(root, 'tmp'), { recursive: true })
      writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
      writeFileSync(join(root, 'src', 'b.tsx'), 'export const b = <div />\n')
      writeFileSync(join(root, 'src', 'schema.entities.json'), '{}\n')
      writeFileSync(join(root, 'src', 'notes.md'), '# Notes\n')
      writeFileSync(join(root, 'node_modules', 'pkg', 'index.ts'), 'export const nope = 1\n')
      writeFileSync(join(root, 'generated', 'types.ts'), 'export const generated = 1\n')
      writeFileSync(join(root, 'tmp', 'fixture.ts'), 'export const tmp = 1\n')

      expect(collectLintTargets(root)).toEqual([
        'src/a.ts',
        'src/b.tsx',
        'src/schema.entities.json',
      ])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('re-lints only changed, new, or previously failing files', () => {
    const hashes = new Map([
      ['a.ts', hashContent('a')],
      ['b.ts', hashContent('b')],
      ['c.ts', hashContent('c')],
      ['d.ts', hashContent('d')],
    ])
    const cache = {
      files: {
        'a.ts': { hash: hashContent('a'), status: 'ok' as const },
        'b.ts': { hash: hashContent('old'), status: 'ok' as const },
        'd.ts': { hash: hashContent('d'), status: 'error' as const },
      },
      version: 1 as const,
    }

    expect(pendingLintTargets([...hashes.keys()], hashes, cache)).toEqual(['b.ts', 'c.ts', 'd.ts'])
  })

  test('changes the cache key when the config changes', () => {
    const root = tempDirectory('basis-cache-key')
    try {
      const config = join(root, 'eslint.config.mjs')
      writeFileSync(config, 'export default []\n')
      const before = computeLintCacheKey({ configPath: config, cwd: root, sourceRoots: [] })
      writeFileSync(config, 'export default [{ rules: {} }]\n')
      const after = computeLintCacheKey({ configPath: config, cwd: root, sourceRoots: [] })

      expect(after).not.toBe(before)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})

describe('lint cache error attribution', () => {
  test('marks only files that Bun lint reported', () => {
    const root = tempDirectory('basis-cache-errors')
    try {
      const output = [
        join(root, 'a.ts'),
        '  1:1  error  bad  test/rule',
        '',
        join(root, 'b.ts'),
        '  2:1  error  worse  test/rule',
        '',
        '✖ 2 problems (2 errors, 0 warnings)',
      ].join('\n')

      expect(erroredLintTargets(output, root, ['a.ts', 'b.ts', 'c.ts'])).toEqual(new Set(['a.ts', 'b.ts']))
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
