import type { BunPlugin } from 'bun'
import { pluginMarkdown } from './source/pluginMarkdown'
import { pluginRefresh } from './source/pluginRefresh'
import { pluginSASS } from './source/pluginSASS'

/**
 * The single bundler plugin Bun's development server loads for a Basis app.
 *
 * `[serve.static] plugins` accepts one plugin object per entry, so Basis's
 * development loaders are composed here rather than enumerated separately. The
 * consuming app's `bunfig.toml` references this one module (`basis/serve`),
 * which keeps Basis's plugin stack an implementation detail.
 */
export const pluginServe: BunPlugin = {
  name: 'basis-serve',
  setup(build) {
    for (const plugin of [pluginSASS(), pluginMarkdown(), pluginRefresh()]) {
      plugin.setup(build)
    }
  },
}

// eslint-disable-next-line @basis/no-default-export -- Bun's `[serve.static]` plugin loader requires a default export.
export default pluginServe
