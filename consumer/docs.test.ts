import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkDocs } from './docs'

/** Temporary repositories to remove after each test. */
const directories: string[] = []

/**
 * Create a temporary repository containing the given files.
 * @param files - Map of repository-relative path to contents.
 * @returns The repository root.
 */
function fixture(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'basis-docs-'))
  directories.push(directory)
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(directory, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, contents)
  }
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('checkDocs', () => {
  test('passes a valid tree and returns titles and links', () => {
    const root = fixture({
      'docs/architecture/index.md': '---\ntitle: Architecture\n---\n\nSee [index](../index.md).\n',
      'docs/index.md': '---\ntitle: Home\n---\n\n# Home\n',
    })
    const report = checkDocs(root)
    expect(report.issues).toEqual([])
    expect(report.pages.map(page => page.file)).toEqual(['docs/architecture/index.md', 'docs/index.md'])
    expect(report.pages[0].title).toBe('Architecture')
    expect(report.pages[0].links).toEqual(['../index.md'])
  })

  test('does not require a docs directory', () => {
    const root = fixture({ 'README.md': '# Project\n' })
    expect(checkDocs(root)).toEqual({ issues: [], pages: [] })
  })

  test('requires an index document', () => {
    const root = fixture({ 'docs/guide.md': '# Guide\n' })
    expect(checkDocs(root).issues.map(issue => issue.message)).toContain('missing docs/index.md(x)')
  })

  test('reports an unclosed code fence', () => {
    const root = fixture({ 'docs/index.md': '# Home\n\n```mermaid\nflowchart TD\n' })
    const issues = checkDocs(root).issues
    expect(issues.some(issue => issue.message === 'code fence is not closed')).toBe(true)
  })

  test('reports malformed front-matter', () => {
    const root = fixture({ 'docs/index.md': '---\ntitle: Home\nbroken line\n---\n\n# Home\n' })
    const issues = checkDocs(root).issues
    expect(issues.some(issue => issue.message.startsWith('front-matter line is not a "key: value" pair'))).toBe(true)
  })

  test('reports unresolved internal links and ignores external ones', () => {
    const root = fixture({
      'docs/index.md': [
        '# Home',
        '',
        '[missing](./nope.md)',
        '[external](https://example.com)',
        '[anchor](#section)',
        '[deep](./nested/)',
      ].join('\n'),
      'docs/nested/index.md': '# Nested\n',
    })
    const messages = checkDocs(root).issues.map(issue => issue.message)
    expect(messages).toEqual(['link does not resolve: ./nope.md'])
  })
})
