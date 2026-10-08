import { evaluate } from '@mdx-js/mdx'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import * as React from 'react'
import * as runtime from 'react/jsx-runtime'
import { renderToString } from 'react-dom/server'
import remarkGfm from 'remark-gfm'
import type { DocumentationEntry, DocumentationRoute } from '../../react/components/Documentation/Documentation'
import { buildDocumentationNavigation, Documentation } from '../../react/components/Documentation/Documentation'
import { DOCUMENTATION_FONTS_URL } from '../../react/components/Documentation/typography'
import { Mermaid } from '../../react/components/Mermaid/Mermaid'
import { themeStyles } from '../../react/components/Theme/Theme'
import { styles } from '../../react/utilities/style'
import type { DocsDocument } from './globDocs'
import { globDocs, routePath } from './globDocs'

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
 * MDX `pre` mapping: a Mermaid fence renders through the {@link Mermaid}
 * component, which renders its SVG synchronously at build time. This keeps
 * Mermaid rendering in the component tree instead of string-surgery on
 * generated HTML, and leaves no client bootstrap behind.
 * @param props - The MDX `pre` element props.
 * @returns The Mermaid component or a plain `pre`.
 */
function DocumentationPre(props: React.HTMLAttributes<HTMLPreElement>): React.ReactElement {
  const child = React.Children.toArray(props.children)[0]
  if (React.isValidElement<{ children?: React.ReactNode, className?: string }>(child)) {
    const { children, className } = child.props
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

  for (const document of globDocs(source)) pages.set(document.path, document)
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
  const modulePaths = new Set(site.modules.keys())
  const routes: DocumentationRoute[] = []
  for (const page of site.pages.values()) {
    const href = pageHref(site.route, page.path)
    if (modulePaths.has(href)) continue
    routes.push({ href, title: page.title })
  }
  for (const [path, page] of site.modules) {
    routes.push({
      href: path,
      parent: page.parent ? pageHref(site.route, page.parent.replace(/^\/+|\/+$/g, '')) : undefined,
      title: page.title,
    })
  }
  return buildDocumentationNavigation(routes)
}

/**
 * Wrap rendered content in the shared documentation shell and an HTML document.
 *
 * Inlines Basis's theme variables and every registered stylesheet, so a built
 * page carries the same presentation as the docs app without caller CSS. Mermaid
 * diagrams are rendered to SVG during this pass, so no client bootstrap is
 * needed.
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
    '</body></html>',
  ].join('')
}

/**
 * Render a Markdown/MDX page to a full HTML document.
 * @param site - The resolved site.
 * @param page - The page to render.
 * @returns A complete HTML document.
 */
export async function mdxToHTML(site: DocsSite, page: DocsPage): Promise<string> {
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
export function moduleToHTML(site: DocsSite, page: DocsPageModule, path: string): string {
  const content = React.createElement(page.component as React.ComponentType, { key: 'content' })
  return layout(site, path, content, page.title)
}

/**
 * Build the resolved site to a static directory, suitable for GitHub Pages.
 *
 * Each page is written as `<outDir>/<route>/index.html`; root-relative links
 * are prefixed with `base` so a project Pages site served under a subpath
 * resolves. Diagrams are rendered to SVG during the build and the
 * documentation fonts load from their configured source, so the output needs no
 * build step of its own.
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
    write(pageHref(site.route, page.path), await mdxToHTML(site, page))
  }
  for (const [path, page] of site.modules) write(path, moduleToHTML(site, page, path))

  return written
}
