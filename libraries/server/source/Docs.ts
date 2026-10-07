import { evaluate } from '@mdx-js/mdx'
import type { FSWatcher } from 'chokidar'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import * as React from 'react'
import * as runtime from 'react/jsx-runtime'
import { renderToString } from 'react-dom/server'
import remarkGfm from 'remark-gfm'
import type { DocumentationEntry } from '../../react/components/Documentation/Documentation'
import { Documentation } from '../../react/components/Documentation/Documentation'
import { DOCUMENTATION_FONTS_URL } from '../../react/components/Documentation/typography'
import { Mermaid, MERMAID_SOURCE } from '../../react/components/Mermaid/Mermaid'
import { themeStyles } from '../../react/components/Theme/Theme'
import { styles } from '../../react/utilities/style'
import type { URI } from '../../utilities'
import type { DocsDocument } from './DocsSource'
import { routePath, scanDocs } from './DocsSource'

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
export type DocsPage = DocsDocument

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

/**
 * Server surfaces the docs route must never claim, even when it owns the site
 * root (`route: '/'`). Without this, a root-mounted docs route would intercept
 * the server's own assets, scripts, and module proxy.
 */
const RESERVED_PREFIXES = ['/api', '/assets', '/health', '/modules', '/ping', '/scripts']

/** A Markdown inline link to a document. */
const DOC_LINK = /\]\(([^)\s]+\.mdx?)(#[^)]*)?\)/g
type MdxContent = React.ComponentType<{
  components?: { pre?: React.ComponentType<React.HTMLAttributes<HTMLPreElement>> },
}>

/** Compiled MDX components, keyed by source path and modification time. */
const compiled = new Map<string, MdxContent>()

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
 * Whether a path is reserved by the server and must not be claimed by docs.
 * @param path - The request pathname.
 * @returns Whether the path is a reserved server surface.
 */
function isReserved(path: string): boolean {
  return RESERVED_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
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
async function compileDocument(source: string, file: string): Promise<MdxContent> {
  const version = `${file}:${statSync(file).mtimeMs}`
  const cached = compiled.get(version)
  if (cached) return cached
  const evaluated = await evaluate(source, { ...runtime, remarkPlugins: [remarkGfm] })
  const { default: Content } = evaluated as { default: MdxContent }
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
 * MDX `pre` mapping: a Mermaid fence renders through the {@link Mermaid}
 * component (whose server render emits the runtime's `<pre class="mermaid">`
 * block); every other code block is left as-is. This keeps Mermaid rendering in
 * the component tree instead of string-surgery on generated HTML.
 * @param props - The MDX `pre` element props.
 * @returns The Mermaid component or a plain `pre`.
 */
function DocumentationPre(props: React.HTMLAttributes<HTMLPreElement>): React.ReactElement {
  const child = React.Children.toArray(props.children)[0]
  if (React.isValidElement(child)) {
    const { children, className } = child.props as { children?: React.ReactNode, className?: string }
    if (className?.includes('language-mermaid')) return React.createElement(Mermaid, null, String(children ?? ''))
  }
  return React.createElement('pre', props)
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

  for (const document of scanDocs(source)) pages.set(document.path, document)
  for (const page of options.pages ?? []) {
    modules.set(pageHref(route, page.path.replace(/^\/+|\/+$/g, '')), page)
  }

  return { modules, pages, route, source, title: options.title ?? 'Documentation' }
}

/**
 * Build the navigation tree from the Markdown/MDX pages and React modules,
 * nesting modules under the parent named by their declared `parent` path.
 * @param site - The resolved site.
 * @returns Sorted navigation entries.
 */
function navigation(site: DocsSite): DocumentationEntry[] {
  const entries: DocumentationEntry[] = []
  const modulePaths = new Set(site.modules.keys())
  for (const page of site.pages.values()) {
    const href = pageHref(site.route, page.path)
    if (modulePaths.has(href)) continue
    entries.push({ href, title: page.title })
  }

  const modules = new Map<string, DocumentationEntry>()
  for (const [path, page] of site.modules) modules.set(path, { children: [], href: path, title: page.title })
  for (const [path, page] of site.modules) {
    const entry = modules.get(path)
    if (!entry) continue
    const parent = page.parent ? modules.get(pageHref(site.route, page.parent.replace(/^\/+|\/+$/g, ''))) : undefined
    if (parent) parent.children = [...(parent.children ?? []), entry]
    else entries.push(entry)
  }

  return entries.sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * Wrap rendered content in the shared documentation shell and an HTML document.
 *
 * Inlines Basis's theme variables and every registered stylesheet, so a served
 * page carries the same presentation as the docs app without caller CSS, and
 * injects the Mermaid and live-reload bootstraps only when they apply.
 * @param site - The resolved site.
 * @param active - The active route path.
 * @param content - The page content.
 * @param title - The page title.
 * @param development - Whether to include the live-reload client.
 * @returns A complete HTML document.
 */
function layout(site: DocsSite, active: string, content: React.ReactNode, title: string, development = false): string {
  const page = React.createElement(
    Documentation,
    { active, navigation: navigation(site), title: site.title },
    content,
  )
  const body = renderToString(page)
  const scripts = [
    body.includes('class="mermaid"') ? mermaidBootstrap() : '',
    development ? hmrClient() : '',
  ].join('')

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
    scripts,
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
  const Content = await compileDocument(rewriteLinks(page.body, page, site), page.source)
  const content = React.createElement(Content, { components: { pre: DocumentationPre }, key: 'content' })
  return layout(site, pageHref(site.route, page.path), content, page.title, development)
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
  return layout(site, path, content, page.title, development)
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
  return layout(site, '', content, 'Not found', development)
}

/**
 * Serve a documentation request, or `null` when the path is outside the route.
 * When the docs are the whole site (`route: '/'`), every non-reserved path is a
 * docs path.
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
  if (isReserved(uri.path)) return null
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

/**
 * Watch a docs tree and invoke `onChange` after any change.
 * @param source - Absolute docs root.
 * @param onChange - Called after a change.
 * @returns The watcher, for teardown.
 */
export async function watchDocs(source: string, onChange: () => void): Promise<FSWatcher> {
  const { watch } = await import('chokidar')
  const watcher = watch(source, { ignoreInitial: true })
  watcher.on('all', () => onChange())
  await new Promise<void>(ready => watcher.once('ready', () => ready()))
  return watcher
}
