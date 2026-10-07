import { compile } from '@mdx-js/mdx'
import type { BunPlugin, PluginBuilder } from 'bun'
import remarkGfm from 'remark-gfm'

/** The minimal Markdown/MDX node shape these transforms read and produce. */
interface MarkdownNode {
  children?: MarkdownNode[],
  lang?: string,
  name?: string,
  type: string,
  value?: string,
}

/**
 * Remove a leading YAML front-matter block so it is metadata, not page content.
 * @param source - The raw document.
 * @returns The document without front-matter.
 */
function stripFrontMatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

/** Whether the document contains a Mermaid fence. */
const MERMAID_FENCE = /^`{3,}\s*mermaid\b/m

/** The import that makes `<Mermaid>` resolve to the component, not a missing reference. */
const MERMAID_IMPORT = "import { Mermaid } from '@basis/react'\n\n"

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
 * A Bun build plugin that compiles Markdown and MDX into React modules.
 *
 * A `.md`/`.mdx` import resolves to a module whose default export is a React
 * component, so documentation pages bundle, hydrate, and hot-reload through the
 * same pipeline as any other component. MDX is a superset of Markdown, so both
 * extensions share one loader; `remark-gfm` adds tables.
 * @returns The Markdown/MDX build plugin.
 */
export function pluginMarkdown(): BunPlugin {
  return {
    name: 'markdown',
    setup(build: PluginBuilder) {
      build.onLoad({ filter: /\.mdx?$/ }, async args => {
        const body = stripFrontMatter(await Bun.file(args.path).text())
        const source = MERMAID_FENCE.test(body) ? MERMAID_IMPORT + body : body
        const compiled = await compile(source, {
          outputFormat: 'program',
          remarkPlugins: [remarkGfm, remarkMermaid as never],
        })
        return { contents: String(compiled), loader: 'js' }
      })
    },
  }
}
