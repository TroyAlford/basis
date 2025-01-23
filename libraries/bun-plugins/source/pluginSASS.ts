import type { BunPlugin, PluginBuilder } from 'bun'
import * as path from 'node:path'
import * as sass from 'sass'

interface PluginSASSOptions {
  /**
   * Whether to minify the CSS output
   * @default true in production, false otherwise
   */
  minify?: boolean,
}

/**
 * A Bun build plugin that compiles SASS/SCSS files into CSS.
 * The plugin automatically handles .scss file imports in your JavaScript/TypeScript code.
 * The CSS is always inlined in a style tag.
 * @param options Configuration options for the plugin
 * @returns A Bun build plugin that handles SASS/SCSS compilation
 * @example Basic usage in Bun build configuration
 * ```typescript
 * import { build } from "bun";
 * import { pluginSASS } from "./pluginSASS";
 *
 * await build({
 *   entrypoints: ['./src/index.ts'],
 *   plugins: [pluginSASS()]
 * });
 * ```
 */
export function pluginSASS(options: PluginSASSOptions = {}): BunPlugin {
  const { minify = Bun.env.NODE_ENV === 'production' } = options

  return {
    name: 'scss',
    setup(build: PluginBuilder) {
      build.onLoad({ filter: /\.scss$/ }, async args => {
        if (build.config.target !== 'browser') {
          return { contents: '', loader: 'js' }
        }

        const result = sass.compile(args.path, {
          style: minify ? 'compressed' : 'expanded',
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
  }
}
