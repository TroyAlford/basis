import type { BunPlugin } from 'bun'
import * as less from 'less'
import * as path from 'node:path'

/**
 * A Bun build plugin that compiles SASS/SCSS files into CSS and injects them into the document head.
 * The plugin automatically handles .scss file imports in your JavaScript/TypeScript code by compiling
 * the SASS content and creating a runtime script that injects the compiled CSS into the page.
 * @returns A Bun build plugin that handles SASS/SCSS compilation and injection
 * @example Basic usage in Bun build configuration
 * ```typescript
 * import { build } from "bun";
 * import { pluginLESS } from "./pluginLESS";
 *
 * await build({
 *   entrypoints: ['./src/index.ts'],
 *   plugins: [
 *     pluginLESS()
 *   ]
 * });
 * ```
 * @example Usage in your JavaScript/TypeScript files
 * // Will be compiled and injected at runtime
 * import './styles.less'
 *
 * // Transformed to:
 * <style data-path="path/to/styles.less">
 * // compiled CSS content
 * </style>
 */
export function pluginLESS(): BunPlugin {
  return {
    name: 'less',
    setup({ config: { target = 'browser' }, onLoad }) {
      onLoad({ filter: /\.less$/ }, async args => ({
        contents: target === 'browser' ? `
          const style = document.createElement('style');
          style.dataset.path = ${JSON.stringify(path.relative(process.cwd(), args.path))};
          style.textContent = ${JSON.stringify(less.render(args.path).then(result => result.css))};
          document.head.appendChild(style);
        ` : '',
        loader: 'js',
      }))
    },
  }
}
