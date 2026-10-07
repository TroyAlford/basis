import { evaluate } from '@mdx-js/mdx'
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
import type { DocsDocument } from './DocsSource'
import { routePath, scanDocs } from './DocsSource'

/** A React documentation page module, rendered alongside the Markdown tree. */
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

/** Options for the documentation site. */
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
 * The client bootstrap that renders Mermaid diagrams in a statically built
 * page, loading the runtime from the shared source only when a diagram is
 * present. Served pages render Mermaid through the component instead.
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
 * component (whose static render emits the runtime's `<pre class="mermaid">`
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
 * Inlines Basis's theme variables and every registered stylesheet, so a built
 * page carries the same presentation as the docs app without caller CSS, and
 * injects the Mermaid bootstrap only when a diagram is present.
 * @param site - The resolved site.
 * @param active - The active route path.
 * @param content - The page content.
 * @param title - The page title.
 * @returns A complete HTML document.
 */
function layout(site: DocsSite, active: string, content: React.ReactNode, title: string): string {
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
    body.includes('class="mermaid"') ? mermaidBootstrap() : '',
    '</body></html>',
  ].join('')
}

/**
 * Render a Markdown/MDX page to a full HTML document.
 * @param site - The resolved site.
 * @param page - The page to render.
 * @returns A complete HTML document.
 */
export async function renderDocsPage(site: DocsSite, page: DocsPage): Promise<string> {
  const Content = await compileDocument(rewriteLinks(page.body, page, site), page.source)
  const content = React.createElement(Content, { components: { pre: DocumentationPre }, key: 'content' })
  return layout(site, pageHref(site.route, page.path), content, page.title)
}

/**
 * Render a React page module to a full HTML document.
 * @param site - The resolved site.
 * @param page - The page module to render.
 * @param path - The module's served path.
 * @returns A complete HTML document.
 */
export function renderDocsModule(site: DocsSite, page: DocsPageModule, path: string): string {
  const content = React.createElement(page.component as React.ComponentType, { key: 'content' })
  return layout(site, path, content, page.title)
}

/**
 * Render the not-found document for an unmatched docs path.
 * @param site - The resolved site.
 * @param path - The requested route path.
 * @returns A complete HTML document.
 */
export function renderDocsNotFound(site: DocsSite, path: string): string {
  const message = `<h1>Not found</h1><p>No documentation page matches <code>${escapeHtml(path)}</code>.</p>`
  const content = React.createElement('div', {
    dangerouslySetInnerHTML: { __html: message },
    key: 'content',
  })
  return layout(site, '', content, 'Not found')
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
    write(pageHref(site.route, page.path), await renderDocsPage(site, page))
  }
  for (const [path, page] of site.modules) write(path, renderDocsModule(site, page, path))

  return written
}
