import { compile } from '@mdx-js/mdx'
import type { BunPlugin, PluginBuilder } from 'bun'
import * as path from 'node:path'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { splitFrontMatter } from '../../utilities'
import { resolveDocsHref } from '../../utilities/functions/docsLink'

/** The minimal Markdown/MDX node shape these transforms read and produce. */
interface MarkdownNode {
  children?: MarkdownNode[],
  lang?: string | null,
  name?: string,
  type: string,
  url?: string,
  value?: string,
}

/**
 * Whether a parsed Markdown tree contains a Mermaid code fence.
 *
 * The parser normalizes backtick and tilde fences to the same `code` node, so
 * the import decision and the fence transformation share one source of truth.
 * @param node - The node to inspect.
 * @returns Whether the node or any descendant is a Mermaid fence.
 */
function containsMermaidFence(node: MarkdownNode): boolean {
  if (node.type === 'code' && node.lang === 'mermaid') return true
  return node.children?.some(containsMermaidFence) ?? false
}

/**
 * Whether a Markdown/MDX source contains a Mermaid fence.
 * @param source - The document source.
 * @returns Whether the document needs the docs Mermaid import.
 */
function hasMermaidFence(source: string): boolean {
  const tree = unified().use(remarkParse).use(remarkMdx).parse(source)
  return containsMermaidFence(tree as unknown as MarkdownNode)
}

/**
 * The import that makes a `mermaid` fence resolve to the docs Mermaid component.
 * The docs setup injects this automatically, so a consumer never imports the
 * diagram component or adds Mermaid to an application bundle.
 */
const MERMAID_IMPORT = "import { Mermaid } from 'basis/docs/mermaid'\n\n"

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
        const source = hasMermaidFence(body) ? MERMAID_IMPORT + body : body
        const compiled = await compile(source, {
          outputFormat: 'program',
          remarkPlugins: [remarkGfm, remarkDocsLinks(args.path, options.docsRoot, options.route ?? '/'), remarkMermaid],
        })
        return { contents: String(compiled), loader: 'js' }
      })
    },
  }
}
