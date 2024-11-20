import type { BunPlugin } from 'bun'
import * as path from 'node:path'
import * as sass from 'sass'

/**
 * A Bun build plugin that compiles SASS/SCSS files into CSS and injects them into the document head.
 * The plugin automatically handles .scss file imports in your JavaScript/TypeScript code by compiling
 * the SASS content and creating a runtime script that injects the compiled CSS into the page.
 * @param root - The root directory path used to generate relative paths for debugging
 * @returns A Bun build plugin that handles SASS/SCSS compilation and injection
 * @example Basic usage in Bun build configuration
 * ```typescript
 * import { build } from "bun";
 * import { pluginSASS } from "./pluginSASS";
 *
 * await build({
 *   entrypoints: ['./src/index.ts'],
 *   plugins: [
 *     pluginSASS(process.cwd())
 *   ]
 * });
 * ```
 * @example Usage in your JavaScript/TypeScript files
 * // Will be compiled and injected at runtime
 * import './styles.scss'
 *
 * // Transformed to:
 * <style data-path="path/to/styles.scss">
 * // compiled CSS content
 * </style>
 */
export function pluginSASS(root: string): BunPlugin {
  return {
    name: 'scss',
    setup(build) {
      build.onLoad({ filter: /\.scss$/ }, async args => {
        const result = sass.compile(args.path)
        // Convert the SCSS import into a JavaScript module that exports the CSS
        return {
          contents: `
            const style = document.createElement('style');
            style.dataset.path = ${JSON.stringify(path.relative(root, args.path))};
            style.textContent = ${JSON.stringify(result.css)};
            document.head.appendChild(style);
          `,
          loader: 'js',
        }
      })
    },
  }
}
