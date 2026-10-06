import type { Dirent } from 'node:fs'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import type { URI } from '../../utilities'

/** Options for the built-in documentation route. */
export interface DocsOptions {
  /** Absolute path to the documentation source tree. */
  root: string,
  /** URL prefix the documentation is served under. Defaults to `/docs`. */
  route?: string,
  /** Navigation heading and document title. Defaults to `Documentation`. */
  title?: string,
}

/** A discovered documentation page. */
export interface DocsPage {
  /** Route path relative to the docs prefix, empty for the index. */
  path: string,
  /** Absolute path to the Markdown/MDX source. */
  source: string,
  /** Page title from front-matter, the first heading, or the filename. */
  title: string,
}

/** A resolved documentation site. */
export interface DocsSite {
  /** Pages keyed by route path. */
  pages: Map<string, DocsPage>,
  /** URL prefix without a trailing slash. */
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

/** A Mermaid fenced code block, as rendered by the Markdown engine. */
const MERMAID = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g

/** An `href` attribute in rendered HTML. */
const HREF = /href="([^"]+)"/g

/** The documentation page stylesheet. */
const STYLE = [
  ':root{--ink:#1f2328;--muted:#57606a;--line:#d8dee4;',
  '--bg:#ffffff;--accent:#0969da;--code:#f6f8fa}',
  '*{box-sizing:border-box}',
  'body{margin:0;color:var(--ink);background:var(--bg);',
  'font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
  '.docs{display:grid;grid-template-columns:16rem minmax(0,48rem);gap:2.5rem;',
  'max-width:64rem;margin:0 auto;padding:2rem}',
  '.docs nav h1{font-size:1rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}',
  '.docs nav ul{list-style:none;margin:.5rem 0;padding:0}',
  '.docs nav a{color:var(--ink);text-decoration:none;display:block;padding:.15rem 0}',
  '.docs nav a[aria-current]{color:var(--accent);font-weight:600}',
  'main h1{margin-top:0}main a{color:var(--accent)}',
  'main code{background:var(--code);padding:.1em .35em;border-radius:4px;font-size:.9em}',
  'main pre{background:var(--code);border:1px solid var(--line);',
  'border-radius:6px;padding:1rem;overflow:auto}',
  'main pre code{background:none;padding:0}',
  'main pre.mermaid{background:#fff;text-align:center;color:var(--muted)}',
  'main table{border-collapse:collapse}',
  'main th,main td{border:1px solid var(--line);padding:.4rem .6rem}',
  'main blockquote{margin:0;padding-left:1rem;border-left:3px solid var(--line);color:var(--muted)}',
].join('')

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
 * Rewrite repository-relative Markdown links to their served routes.
 * @param html - Rendered page HTML.
 * @param page - The page the HTML belongs to.
 * @param site - The resolved site.
 * @returns HTML with in-tree document links rewritten.
 */
function rewriteLinks(html: string, page: DocsPage, site: DocsSite): string {
  return html.replace(HREF, (match, href: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return match
    const [target = '', anchor = ''] = href.split('#')
    if (!/\.mdx?$/i.test(target)) return match
    const resolved = resolve(dirname(page.source), target)
    const relativeFile = relative(site.source, resolved)
    if (relativeFile.startsWith('..')) return match
    const route = routePath(relativeFile)
    const url = route === '' ? site.route : `${site.route}/${route}`
    return `href="${url}${anchor ? `#${anchor}` : ''}"`
  })
}

/**
 * Discover a documentation tree.
 * @param options - The docs root, route, and title.
 * @returns The resolved site.
 */
export function discoverDocs(options: DocsOptions): DocsSite {
  const source = resolve(options.root)
  const route = (options.route ?? '/docs').replace(/\/+$/, '') || '/docs'
  const pages = new Map<string, DocsPage>()

  if (existsSync(source) && statSync(source).isDirectory()) {
    for (const file of collect(source)) {
      const relativeFile = relative(source, file)
      const path = routePath(relativeFile)
      pages.set(path, { path, source: file, title: titleOf(readFileSync(file, 'utf8'), relativeFile) })
    }
  }

  return { pages, route, source, title: options.title ?? 'Documentation' }
}

/**
 * Build the page shell around rendered documentation content.
 * @param site - The resolved site.
 * @param current - The route path being rendered.
 * @param content - Rendered page HTML.
 * @param title - The page title.
 * @returns A complete HTML document.
 */
function layout(site: DocsSite, current: string, content: string, title: string): string {
  const navigation = [...site.pages.values()]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(page => {
      const href = page.path === '' ? site.route : `${site.route}/${page.path}`
      const active = page.path === current ? ' aria-current="page"' : ''
      return `<li><a href="${href}"${active}>${escapeHtml(page.title)}</a></li>`
    })
    .join('\n')

  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)} · ${escapeHtml(site.title)}</title>`,
    `<style>${STYLE}</style></head><body><div class="docs">`,
    `<nav><h1>${escapeHtml(site.title)}</h1><ul>\n${navigation}\n</ul></nav>`,
    `<main>${content}</main>`,
    '</div></body></html>',
  ].join('')
}

/**
 * Render one documentation page to HTML.
 * @param site - The resolved site.
 * @param page - The page to render.
 * @returns A complete HTML document.
 */
export function renderDocsPage(site: DocsSite, page: DocsPage): string {
  const { body } = parse(readFileSync(page.source, 'utf8'))
  const rendered = Bun.markdown.html(body)
    .replace(MERMAID, (_match, code: string) => `<pre class="mermaid">${code}</pre>`)
  return layout(site, page.path, rewriteLinks(rendered, page, site), page.title)
}

/**
 * Render the not-found document for an unmatched docs path.
 * @param site - The resolved site.
 * @param path - The requested route path.
 * @returns A complete HTML document.
 */
export function renderDocsNotFound(site: DocsSite, path: string): string {
  const message = `<h1>Not found</h1><p>No documentation page matches <code>${escapeHtml(path)}</code>.</p>`
  return layout(site, '', message, 'Not found')
}

/**
 * Serve a documentation request, or `null` when the path is outside the route.
 * @param site - The resolved docs site.
 * @param uri - The parsed request URI.
 * @param request - The incoming request.
 * @returns The docs response, or `null` when the path is not a docs path.
 */
export function serveDocs(site: DocsSite, uri: URI, request: Request): Response | null {
  if (uri.path !== site.route && !uri.path.startsWith(`${site.route}/`)) return null
  if (request.method !== 'GET') {
    return new Response(null, {
      headers: { allow: 'GET' },
      status: 405,
      statusText: 'Method Not Allowed',
    })
  }
  const path = uri.path.slice(site.route.length).replace(/^\/+|\/+$/g, '')
  const page = site.pages.get(path)
  const html = page ? renderDocsPage(site, page) : renderDocsNotFound(site, path)
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
    status: page ? 200 : 404,
  })
}
