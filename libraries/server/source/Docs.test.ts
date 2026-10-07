import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { discoverDocs, renderDocsNotFound, renderDocsPage, serveDocs } from './Docs'

/** Temporary docs trees to remove after each test. */
const directories: string[] = []

/**
 * Create a temporary repository containing the given files.
 * @param files - Map of repository-relative path to contents.
 * @returns The repository root.
 */
function fixture(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'basis-docs-server-'))
  directories.push(directory)
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(directory, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, contents)
  }
  return directory
}

/**
 * Read a discovered page, failing the test when it is absent.
 * @param site - The resolved site.
 * @param path - The route path to read.
 * @returns The page.
 */
function page(site: ReturnType<typeof discoverDocs>, path: string) {
  const found = site.pages.get(path)
  if (!found) throw new Error(`missing docs page: ${path}`)
  return found
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('discoverDocs', () => {
  test('keys index documents by directory and others by name', () => {
    const root = fixture({
      'docs/architecture/index.mdx': '---\ntitle: Architecture\n---\n',
      'docs/guides/setup.md': '# Setup\n',
      'docs/index.mdx': '# Home\n',
    })
    const site = discoverDocs({ root: join(root, 'docs'), title: 'Basis' })
    expect([...site.pages.keys()].sort()).toEqual(['', 'architecture', 'guides/setup'])
    expect(page(site, 'architecture').title).toBe('Architecture')
    expect(page(site, 'guides/setup').title).toBe('Setup')
    expect(page(site, '').title).toBe('Home')
  })
})

describe('renderDocsPage', () => {
  test('renders Markdown/MDX, strips front-matter, and builds navigation', async () => {
    const root = fixture({
      'docs/architecture/index.mdx': '---\ntitle: Architecture\n---\n\n# Architecture\n\nSee [home](../index.mdx).\n',
      'docs/index.mdx': '# Home\n',
    })
    const site = discoverDocs({ root: join(root, 'docs') })
    const html = await renderDocsPage(site, page(site, 'architecture'))
    expect(html).toContain('<h1>Architecture</h1>')
    expect(html).not.toContain('title: Architecture')
    expect(html).toContain('href="/docs"')
  })

  test('emits Mermaid fences as a mermaid block and loads the runtime', async () => {
    const root = fixture({ 'docs/index.mdx': '# Home\n\n```mermaid\nflowchart TD\n  A-->B\n```\n' })
    const site = discoverDocs({ root: join(root, 'docs') })
    const html = await renderDocsPage(site, page(site, ''))
    expect(html).toContain('<pre class="mermaid">')
    expect(html).toContain('flowchart TD')
    expect(html).toContain('esm.sh/mermaid')
  })
  test('includes the live-reload client in development', async () => {
    const root = fixture({ 'docs/index.mdx': '# Home\n' })
    const site = discoverDocs({ root: join(root, 'docs'), route: '/' })
    const response = await serveDocs(site, { path: '/' } as never, new Request('http://localhost/'), true)
    expect(await response?.text()).toContain('/hmr')
  })

  test('renders a not-found document', () => {
    const root = fixture({ 'docs/index.mdx': '# Home\n' })
    const site = discoverDocs({ root: join(root, 'docs') })
    const html = renderDocsNotFound(site, 'missing')
    expect(html).toContain('<h1>Not found</h1>')
    expect(html).toContain('missing')
  })
})
