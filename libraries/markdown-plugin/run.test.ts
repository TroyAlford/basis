import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lintMarkdown } from './run'

const WRAPPED_MD = '# Notes\n\n\nA paragraph that\nwraps across lines.\n'
const FIXED_MD = '# Notes\n\nA paragraph that wraps across lines.\n'
const WRAPPED_MDX = 'A paragraph with <Note /> and a\nsoft wrapped line.\n'
const FIXED_MDX = 'A paragraph with <Note /> and a soft wrapped line.\n'
const WRAPPED_GENERIC_MD = 'Use `<T>` in a paragraph that\nwraps across lines.\n'
const FIXED_GENERIC_MD = 'Use `<T>` in a paragraph that wraps across lines.\n'

/**
 * Runs a callback against a throwaway Markdown tree.
 * @param run - The callback receiving the tree root.
 * @returns A promise that resolves once the tree is cleaned up.
 */
const withTree = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'basis-markdown-'))
  try {
    await run(root)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

describe('lintMarkdown', () => {
  test('reports without changing files', async () => {
    await withTree(async root => {
      writeFileSync(join(root, 'notes.md'), WRAPPED_MD)

      const report = await lintMarkdown({ root })

      expect(report.files).toBe(1)
      expect(report.issues.length).toBeGreaterThan(0)
      expect(report.changed).toBe(0)
      expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe(WRAPPED_MD)
    })
  })

  test('fixes Markdown and MDX and converges', async () => {
    await withTree(async root => {
      writeFileSync(join(root, 'notes.md'), WRAPPED_MD)
      writeFileSync(join(root, 'notes.mdx'), WRAPPED_MDX)

      const fixed = await lintMarkdown({ fix: true, root })

      expect(fixed.changed).toBe(2)
      expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe(FIXED_MD)
      expect(readFileSync(join(root, 'notes.mdx'), 'utf8')).toBe(FIXED_MDX)

      const clean = await lintMarkdown({ root })
      expect(clean.issues).toEqual([])
    })
  })

  test('parses .md prose that is not valid MDX', async () => {
    await withTree(async root => {
      writeFileSync(join(root, 'generics.md'), WRAPPED_GENERIC_MD)

      const report = await lintMarkdown({ fix: true, root })

      expect(report.changed).toBe(1)
      expect(readFileSync(join(root, 'generics.md'), 'utf8')).toBe(FIXED_GENERIC_MD)
    })
  })

  test('ignores node_modules', async () => {
    await withTree(async root => {
      mkdirSync(join(root, 'node_modules'))
      writeFileSync(join(root, 'node_modules', 'ignored.md'), WRAPPED_MD)

      const report = await lintMarkdown({ fix: true, root })

      expect(report.files).toBe(0)
      expect(readFileSync(join(root, 'node_modules', 'ignored.md'), 'utf8')).toBe(WRAPPED_MD)
    })
  })
})
