import { compile } from '@mdx-js/mdx'
import type { BunPlugin, PluginBuilder } from 'bun'
import remarkGfm from 'remark-gfm'

/**
 * A Bun build plugin that compiles Markdown and MDX into React modules.
 *
 * A `.md`/`.mdx` import resolves to a module whose default export is a React
 * component, so documentation pages bundle, hydrate, and hot-reload through the
 * same pipeline as any other component. MDX is a superset of Markdown, so both
 * extensions share one loader; `remark-gfm` adds tables and the other
 * GitHub-flavored Markdown extensions.
 * @returns The Markdown/MDX build plugin.
 */
export function pluginMarkdown(): BunPlugin {
  return {
    name: 'markdown',
    setup(build: PluginBuilder) {
      build.onLoad({ filter: /\.mdx?$/ }, async args => {
        const source = await Bun.file(args.path).text()
        const compiled = await compile(source, {
          outputFormat: 'program',
          remarkPlugins: [remarkGfm],
        })
        return { contents: String(compiled), loader: 'js' }
      })
    },
  }
}
