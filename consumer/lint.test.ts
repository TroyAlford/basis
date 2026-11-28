import { tempDirectory } from 'basis/testing'
import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findEslintConfig, runBunLint } from './lint'

describe('ESLint config discovery', () => {
  test('walks up from a nested repository directory', () => {
    const root = tempDirectory('basis-config')
    try {
      const config = join(root, 'eslint.config.mjs')
      const nested = join(root, 'packages', 'app', 'src')
      mkdirSync(nested, { recursive: true })
      writeFileSync(config, 'export default []\n')

      expect(findEslintConfig(nested)).toBe(config)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('returns the nearest config', () => {
    const root = tempDirectory('basis-config')
    try {
      const outer = join(root, 'eslint.config.mjs')
      const nested = join(root, 'packages', 'app')
      const inner = join(nested, 'eslint.config.js')
      mkdirSync(nested, { recursive: true })
      writeFileSync(outer, 'export default []\n')
      writeFileSync(inner, 'export default []\n')

      expect(findEslintConfig(nested)).toBe(inner)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})

describe('lint config scoping', () => {
  test('lets Bun decide per-config ignores instead of prefiltering files', async () => {
    const root = tempDirectory('basis-lint-scope')
    try {
      mkdirSync(join(root, 'src'), { recursive: true })
      writeFileSync(join(root, 'src', 'skip.ts'), 'debugger\n')
      const config = join(root, 'eslint.config.mjs')
      writeFileSync(config, [
        'export default [',
        "  { files: ['**/*.ts'], ignores: ['src/skip.ts'], rules: { 'no-console': 'error' } },",
        "  { files: ['**/*.ts'], rules: { 'no-debugger': 'error' } },",
        ']',
        '',
      ].join('\n'))

      expect(await runBunLint(false, config, '.', root)).toBe(1)
      expect(await runBunLint(false, config, '.', root)).toBe(1)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
