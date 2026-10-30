import { compile } from '@mdx-js/mdx'
import type { BunPlugin, PluginBuilder } from 'bun'
import * as path from 'node:path'
import remarkGfm from 'remark-gfm'
import { splitFrontMatter } from '../../utilities'
import { resolveDocsHref } from '../../utilities/functions/docsLink'

/** The minimal Markdown/MDX node shape these transforms read and produce. */
interface MarkdownNode {
  children?: MarkdownNode[],
  lang?: string,
  name?: string,
  type: string,
  url?: string,
  value?: string,
}

/** Whether the document contains a Mermaid fence. */
const MERMAID_FENCE = /^`{3,}\s*mermaid\b/m

/**
 * The import that makes `<Mermaid>` resolve to the component, not a missing
 * reference. This uses the consumer-facing `basis/react` specifier — the same
 * one every Basis consumer imports — which resolves in this repository and in a
 * consuming install alike, so the plugin never guesses at the package name.
 */
const MERMAID_IMPORT = "import { Mermaid } from 'basis/react'\n\n"

/** Options for the Markdown/MDX loader. */
export interface MarkdownPluginOptions {
  /** Absolute docs root used to resolve in-tree document links. */
  docsRoot?: string,
  /** Served docs prefix. Defaults to `/`. */
  route?: string,
}

/**
 * Rewrite Mermaid code fences as the Mermaid component, so diagrams render
 * through the component instead of a raw code block.
 * @returns A remark transformer.
 */
function remarkMermaid() {
  return (tree: MarkdownNode): void => {
    const transform = (node: MarkdownNode): void => {
      if (!node.children) return
      node.children = node.children.map(child => {
        if (child.type === 'code' && child.lang === 'mermaid') {
          return {
            children: [{ type: 'text', value: child.value ?? '' }],
            name: 'Mermaid',
            type: 'mdxJsxFlowElement',
          }
        }
        transform(child)
        return child
      })
    }

    transform(tree)
  }
}

/**
 * Rewrite relative Markdown document links to their live served routes.
 * @param filePath - Absolute source path being compiled.
 * @param docsRoot - Explicit docs root, when supplied.
 * @param route - Served docs prefix.
 * @returns A remark transformer.
 */
function remarkDocsLinks(filePath: string, docsRoot: string | undefined, route: string) {
  return () => (tree: MarkdownNode): void => {
    const root = docsRoot ?? inferDocsRoot(filePath)
    const transform = (node: MarkdownNode | undefined): void => {
      if (!node) return
      if (node.children) for (const child of node.children) transform(child)
      if (node.type !== 'link' || !node.url || !root) return

      const [href, anchor] = node.url.split('#', 2)
      if (href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(href) || !/\.mdx?$/i.test(href)) return
      const resolved = resolveDocsHref(filePath, href, root, route)
      if (resolved) node.url = `${resolved}${anchor ? `#${anchor}` : ''}`
    }

    transform(tree)
  }
}

/**
 * Find the docs root containing a source file.
 * @param filePath - Absolute source path.
 * @returns The docs root, or null when the file is not under a `docs` directory.
 */
function inferDocsRoot(filePath: string): string | null {
  const marker = `${path.sep}docs${path.sep}`
  const index = filePath.lastIndexOf(marker)
  return index === -1 ? null : filePath.slice(0, index + marker.length - 1)
}

/**
 * A Bun build plugin that compiles Markdown and MDX into React modules.
 *
 * A `.md`/`.mdx` import resolves to a module whose default export is a React
 * component, so documentation pages bundle, hydrate, and hot-reload through the
 * same pipeline as any other component. MDX is a superset of Markdown, so both
 * extensions share one loader; `remark-gfm` adds tables.
 * @param options - Optional docs root and served prefix for source-link rewriting.
 * @returns The Markdown/MDX build plugin.
 */
export function pluginMarkdown(options: MarkdownPluginOptions = {}): BunPlugin {
  return {
    name: 'markdown',
    setup(build: PluginBuilder) {
      build.onLoad({ filter: /\.mdx?$/ }, async args => {
        const body = splitFrontMatter(await Bun.file(args.path).text()).body
        const source = MERMAID_FENCE.test(body) ? MERMAID_IMPORT + body : body
        const compiled = await compile(source, {
          outputFormat: 'program',
          remarkPlugins: [remarkGfm, remarkDocsLinks(args.path, options.docsRoot, options.route ?? '/'), remarkMermaid],
        })
        return { contents: String(compiled), loader: 'js' }
      })
    },
  }
}
