import { evaluate } from '@mdx-js/mdx'
import type { Dirent } from 'node:fs'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import * as React from 'react'
import * as runtime from 'react/jsx-runtime'
import { renderToString } from 'react-dom/server'
import remarkGfm from 'remark-gfm'
import type { DocumentationEntry } from '../../react/components/Documentation/Documentation'
import { Documentation } from '../../react/components/Documentation/Documentation'
import { DOCUMENTATION_FONTS_URL } from '../../react/components/Documentation/typography'
import { MERMAID_SOURCE } from '../../react/components/Mermaid/Mermaid'
import { themeStyles } from '../../react/components/Theme/Theme'
import { styles } from '../../react/utilities/style'
import type { URI } from '../../utilities'

/** A React documentation page module, served alongside the Markdown tree. */
export interface DocsPageModule {
  /** React component rendered at the page. */
  component: React.ComponentType,
  /** Optional parent route path for nested navigation. */
  parent?: string,
  /** Route path, absolute or relative to the docs prefix. */
  path: string,
  /** Display title. */
  title: string,
}

/** Options for the built-in documentation route. */
export interface DocsOptions {
  /** React page modules served alongside the Markdown/MDX tree. */
  pages?: DocsPageModule[],
  /** Absolute path to the documentation source tree. */
  root: string,
  /** URL prefix the documentation is served under. Defaults to `/docs`. */
  route?: string,
  /** Navigation heading and document title. Defaults to `Documentation`. */
  title?: string,
}

/** A discovered Markdown/MDX documentation page. */
export interface DocsPage {
  /** Route path relative to the docs prefix, empty for the index. */
  path: string,
  /** Absolute path to the source. */
  source: string,
  /** Page title from front-matter, the first heading, or the filename. */
  title: string,
}

/** A resolved documentation site. */
export interface DocsSite {
  /** React page modules keyed by their served path. */
  modules: Map<string, DocsPageModule>,
  /** Markdown/MDX pages keyed by route path relative to the prefix. */
  pages: Map<string, DocsPage>,
  /** URL prefix without a trailing slash, or `/` when the docs are the site. */
  route: string,
  /** Absolute documentation root. */
  source: string,
  /** Navigation heading. */
  title: string,
}

/** Markdown/MDX extensions the docs route recognizes. */
const EXTENSIONS = ['.md', '.mdx']

/** A leading YAML front-matter block. */
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** A level-one Markdown heading. */
const HEADING = /^#\s+(.+)$/m

/** A front-matter `title:` entry. */
const TITLE = /^title:\s*(.+)$/m

/** A Mermaid fenced code block, as rendered by the MDX pipeline. */
const MERMAID = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g

/** A Markdown inline link to a document. */
const DOC_LINK = /\]\(([^)\s]+\.mdx?)(#[^)]*)?\)/g

/** Compiled MDX components, keyed by source path and modification time. */
const compiled = new Map<string, React.ComponentType>()

/**
 * Normalize a docs URL prefix. An explicit `/` means the docs are the whole
 * site; anything else is served under that prefix; the default is `/docs`.
 * @param route - The requested prefix, if any.
 * @returns The normalized prefix.
 */
function normalizeRoute(route?: string): string {
  if (route === undefined || route === '') return '/docs'
  const trimmed = route.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/**
 * The href for a page under a docs prefix.
 * @param route - The docs prefix (`/` for the site root).
 * @param path - The route path relative to the prefix.
 * @returns The absolute href.
 */
function pageHref(route: string, path: string): string {
  if (route === '/') return path === '' ? '/' : `/${path}`
  return path === '' ? route : `${route}/${path}`
}

/**
 * Whether a path is a recognized documentation source document.
 * @param path - Path to test.
 * @returns Whether the path ends in a docs extension.
 */
function isDocument(path: string): boolean {
  return EXTENSIONS.includes(extname(path).toLowerCase())
}

/**
 * Recursively collect documentation documents under a directory.
 * @param directory - Absolute directory to walk.
 * @returns Absolute document paths, sorted for stable output.
 */
function collect(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true }) as Dirent[]) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...collect(path))
    else if (entry.isFile() && isDocument(path)) found.push(path)
  }
  return found.sort()
}

/**
 * Convert a docs-relative source path to a route path.
 * @param relativeFile - Source path relative to the docs root.
 * @returns The route path (empty for an index document).
 */
function routePath(relativeFile: string): string {
  const segments = relativeFile.replace(/\.mdx?$/i, '').split(/[\\/]/)
  if (segments[segments.length - 1] === 'index') segments.pop()
  return segments.join('/')
}

/**
 * Split front-matter from a document and read its title.
 * @param contents - Full document text.
 * @returns The body without front-matter and the title, when present.
 */
function parse(contents: string): { body: string, title: string | null } {
  const fence = FRONT_MATTER.exec(contents)
  const body = fence ? contents.slice(fence[0].length) : contents
  const raw = (fence ? TITLE.exec(fence[1])?.[1] : undefined) ?? HEADING.exec(body)?.[1]
  return { body, title: raw ? raw.replace(/^["']|["']$/g, '').trim() : null }
}

/**
 * Derive a display title for a document.
 * @param contents - Full document text.
 * @param relativeFile - Source path relative to the docs root.
 * @returns The front-matter title, first heading, or a filename fallback.
 */
function titleOf(contents: string, relativeFile: string): string {
  const parsed = parse(contents)
  if (parsed.title) return parsed.title
  const filename = relativeFile.split(/[\\/]/).pop() ?? ''
  const fallback = filename.replace(/\.mdx?$/i, '').replace(/[-_]+/g, ' ')
  return fallback.charAt(0).toUpperCase() + fallback.slice(1)
}

/**
 * Escape text for interpolation into HTML.
 * @param value - Text to escape.
 * @returns The escaped text.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Rewrite repository-relative Markdown document links to their served routes.
 * @param markdown - Markdown/MDX source.
 * @param page - The page the source belongs to.
 * @param site - The resolved site.
 * @returns Source with in-tree document links rewritten.
 */
function rewriteLinks(markdown: string, page: DocsPage, site: DocsSite): string {
  return markdown.replace(DOC_LINK, (match, target: string, anchor = '') => {
    const resolved = resolve(dirname(page.source), target)
    const relativeFile = relative(site.source, resolved)
    if (relativeFile.startsWith('..')) return match
    return `](${pageHref(site.route, routePath(relativeFile))}${anchor ?? ''})`
  })
}

/**
 * Compile a Markdown/MDX document to a React component, cached by modification
 * time so a change only recompiles the affected page.
 * @param source - The document body.
 * @param file - Absolute source path.
 * @returns The compiled component.
 */
async function compileDocument(source: string, file: string): Promise<React.ComponentType> {
  const version = `${file}:${statSync(file).mtimeMs}`
  const cached = compiled.get(version)
  if (cached) return cached
  const { default: Content } = await evaluate(source, { ...runtime, remarkPlugins: [remarkGfm] })
  compiled.set(version, Content)
  return Content
}

/**
 * Clear the compiled-document cache so the next request recompiles every page.
 */
export function clearDocsCache(): void {
  compiled.clear()
}

/**
 * The client bootstrap that reloads the page when the server broadcasts an HMR
 * update, wired to the server's existing `hmr` socket.
 * @returns The module script.
 */
function hmrClient(): string {
  return [
    '<script type="module">',
    "  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'",
    '  const socket = new WebSocket(protocol + "://" + location.host + "/hmr")',
    "  socket.addEventListener('message', () => location.reload())",
    '</script>',
  ].join('\n')
}

/**
 * The client bootstrap that renders Mermaid diagrams in the browser, loading
 * the runtime from the shared source only when a page contains a diagram.
 * @returns The module script.
 */
function mermaidBootstrap(): string {
  return [
    '<script type="module">',
    `  import mermaid from '${MERMAID_SOURCE}'`,
    '  mermaid.initialize({ startOnLoad: false })',
    "  await mermaid.run({ nodes: document.querySelectorAll('.mermaid') })",
    '</script>',
  ].join('\n')
}

/**
 * Discover a documentation site: the Markdown/MDX tree plus any React modules.
 * @param options - The docs root, route, title, and React pages.
 * @returns The resolved site.
 */
export function discoverDocs(options: DocsOptions): DocsSite {
  const source = resolve(options.root)
  const route = normalizeRoute(options.route)
  const pages = new Map<string, DocsPage>()
  const modules = new Map<string, DocsPageModule>()

  if (existsSync(source) && statSync(source).isDirectory()) {
    for (const file of collect(source)) {
      const relativeFile = relative(source, file)
      const path = routePath(relativeFile)
      pages.set(path, { path, source: file, title: titleOf(readFileSync(file, 'utf8'), relativeFile) })
    }
  }

  for (const page of options.pages ?? []) {
    modules.set(pageHref(route, page.path.replace(/^\/+|\/+$/g, '')), page)
  }

  return { modules, pages, route, source, title: options.title ?? 'Documentation' }
}

/**
 * Build the navigation tree from the Markdown/MDX pages and React modules.
 * @param site - The resolved site.
 * @returns Sorted navigation entries.
 */
function navigation(site: DocsSite): DocumentationEntry[] {
  const entries: DocumentationEntry[] = []
  for (const page of site.pages.values()) entries.push({ href: pageHref(site.route, page.path), title: page.title })
  for (const [path, page] of site.modules) entries.push({ href: path, title: page.title })
  return entries.sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * Wrap rendered content in the shared documentation shell and an HTML document.
 *
 * Inlines Basis's theme variables and every registered stylesheet, so a served
 * page carries the same presentation as the docs app without caller CSS.
 * @param site - The resolved site.
 * @param active - The active route path.
 * @param content - The page content.
 * @param title - The page title.
 * @param diagrams - Whether the page contains Mermaid diagrams.
 * @param development - Whether to include the live-reload client.
 * @returns A complete HTML document.
 */
function layout(
  site: DocsSite,
  active: string,
  content: React.ReactNode,
  title: string,
  diagrams = false,
  development = false,
): string {
  const page = React.createElement(
    Documentation,
    { active, navigation: navigation(site), title: site.title },
    content,
  )
  const body = renderToString(page)
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)} · ${escapeHtml(site.title)}</title>`,
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${DOCUMENTATION_FONTS_URL}">`,
    `<style>${themeStyles()}</style>`,
    `<style>${styles()}</style>`,
    '</head><body>',
    body,
    diagrams ? mermaidBootstrap() : '',
    development ? hmrClient() : '',
    '</body></html>',
  ].join('')
}

/**
 * Render a Markdown/MDX page to a full HTML document.
 * @param site - The resolved site.
 * @param page - The page to render.
 * @param development - Whether to include the live-reload client.
 * @returns A complete HTML document.
 */
export async function renderDocsPage(site: DocsSite, page: DocsPage, development = false): Promise<string> {
  const source = readFileSync(page.source, 'utf8')
  const { body } = parse(source)
  const Content = await compileDocument(rewriteLinks(body, page, site), page.source)
  const html = renderToString(React.createElement(Content))
    .replace(MERMAID, (_match, code: string) => `<pre class="mermaid">${code}</pre>`)
  const content = React.createElement('div', {
    dangerouslySetInnerHTML: { __html: html },
    key: 'content',
  })
  const diagrams = html.includes('class="mermaid"')
  return layout(site, pageHref(site.route, page.path), content, page.title, diagrams, development)
}

/**
 * Render a React page module to a full HTML document.
 * @param site - The resolved site.
 * @param page - The page module to render.
 * @param path - The module's served path.
 * @param development - Whether to include the live-reload client.
 * @returns A complete HTML document.
 */
export function renderDocsModule(site: DocsSite, page: DocsPageModule, path: string, development = false): string {
  const content = React.createElement(page.component as React.ComponentType, { key: 'content' })
  return layout(site, path, content, page.title, false, development)
}

/**
 * Render the not-found document for an unmatched docs path.
 * @param site - The resolved site.
 * @param path - The requested route path.
 * @param development - Whether to include the live-reload client.
 * @returns A complete HTML document.
 */
export function renderDocsNotFound(site: DocsSite, path: string, development = false): string {
  const message = `<h1>Not found</h1><p>No documentation page matches <code>${escapeHtml(path)}</code>.</p>`
  const content = React.createElement('div', {
    dangerouslySetInnerHTML: { __html: message },
    key: 'content',
  })
  return layout(site, '', content, 'Not found', false, development)
}

/**
 * Serve a documentation request, or `null` when the path is outside the route.
 * When the docs are the whole site (`route: '/'`), every path is a docs path.
 * @param site - The resolved docs site.
 * @param uri - The parsed request URI.
 * @param request - The incoming request.
 * @param development - Whether to include the live-reload client.
 * @returns The docs response, or `null` when the path is not a docs path.
 */
export async function serveDocs(
  site: DocsSite,
  uri: URI,
  request: Request,
  development = false,
): Promise<Response | null> {
  const module = site.modules.get(uri.path)
  const underRoute = site.route === '/'
    ? uri.path.startsWith('/')
    : uri.path === site.route || uri.path.startsWith(`${site.route}/`)
  if (!module && !underRoute) return null
  if (request.method !== 'GET') {
    return new Response(null, {
      headers: { allow: 'GET' },
      status: 405,
      statusText: 'Method Not Allowed',
    })
  }
  const respond = (html: string, status: number): Response => (
    new Response(html, { headers: { 'Content-Type': 'text/html' }, status })
  )
  if (module) return respond(renderDocsModule(site, module, uri.path, development), 200)
  const path = site.route === '/'
    ? uri.path.replace(/^\/+|\/+$/g, '')
    : uri.path.slice(site.route.length).replace(/^\/+|\/+$/g, '')
  const page = site.pages.get(path)
  const rendered = page
    ? await renderDocsPage(site, page, development)
    : renderDocsNotFound(site, path, development)
  return respond(rendered, page ? 200 : 404)
}

/**
 * Build the resolved site to a static directory, suitable for GitHub Pages.
 *
 * Each page is written as `<outDir>/<route>/index.html`; root-relative links
 * are prefixed with `base` so a project Pages site served under a subpath
 * resolves. Mermaid and the documentation fonts load from their configured
 * sources, so the output needs no build step of its own.
 * @param site - The resolved site.
 * @param outDir - Absolute output directory.
 * @param base - Optional base path prefixed to root-relative links.
 * @returns The written file paths.
 */
export async function buildDocs(site: DocsSite, outDir: string, base = ''): Promise<string[]> {
  const written: string[] = []
  const write = (route: string, html: string): void => {
    const output = base === '' ? html : html.replace(/href="\//g, `href="${base}/`)
    const target = join(outDir, route === '/' ? '' : route.replace(/^\/+/, ''), 'index.html')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, output)
    written.push(target)
  }

  for (const page of site.pages.values()) {
    write(pageHref(site.route, page.path), await renderDocsPage(site, page, false))
  }
  for (const [path, page] of site.modules) write(path, renderDocsModule(site, page, path, false))

  return written
}
