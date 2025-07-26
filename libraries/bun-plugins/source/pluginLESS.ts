import type { BunPlugin, PluginBuilder } from 'bun'
import less from 'less'
import * as path from 'node:path'

interface PluginLESSOptions {
  /**
   * Whether to minify the CSS output
   * @default true in production, false otherwise
   */
  minify?: boolean,
}

/**
 * A Bun build plugin that compiles LESS files into CSS.
 * The plugin automatically handles .less file imports in your JavaScript/TypeScript code.
 * The CSS is always inlined in a style tag.
 * @param options Configuration options for the plugin
 * @returns A Bun build plugin that handles LESS compilation
 * @example Basic usage in Bun build configuration
 * ```typescript
 * import { build } from "bun";
 * import { pluginLESS } from "./pluginLESS";
 *
 * await build({
 *   entrypoints: ['./src/index.ts'],
 *   plugins: [pluginLESS()]
 * });
 * ```
 */
export function pluginLESS(options: PluginLESSOptions = {}): BunPlugin {
  const { minify = Bun.env.NODE_ENV === 'production' } = options

  return {
    name: 'less',
    setup(build: PluginBuilder) {
      build.onLoad({ filter: /\.less$/ }, async args => {
        if (build.config.target !== 'browser') {
          return { contents: '', loader: 'js' }
        }

        const source = await Bun.file(args.path).text()
        const result = await less.render(source, {
          compress: minify,
          filename: args.path,
          javascriptEnabled: true,
          paths: [path.resolve(process.cwd(), 'node_modules')],
        })

        return {
          contents: `
            const style = document.createElement('style');
            style.dataset.path = ${JSON.stringify(path.relative(process.cwd(), args.path))};
            style.textContent = ${JSON.stringify(result.css)};
            document.head.appendChild(style);
          `,
          loader: 'js',
          watchFiles: [args.path],
        }
      })
    },
  } as BunPlugin
}
