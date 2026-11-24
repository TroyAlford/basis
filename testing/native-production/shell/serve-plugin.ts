import { pluginHMR, pluginMarkdown, pluginSASS, pluginVendor } from 'basis/serve'
import type { BunPlugin } from 'bun'

const plugins = [pluginSASS(), pluginMarkdown(), pluginHMR()]
if (Bun.env.NATIVE_VARIANT !== 'A') plugins.push(pluginVendor())

const plugin: BunPlugin = {
  name: 'native-production-diagnostic',
  setup(build) {
    for (const composed of plugins) composed.setup(build)
  },
}

// eslint-disable-next-line @basis/no-default-export -- Bun's serve plugin loader requires a default export.
export default plugin
