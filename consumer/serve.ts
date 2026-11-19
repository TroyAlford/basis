/**
 * Consumer-facing entrypoint for the bundler plugin Bun's development server
 * loads from the consuming app's `bunfig.toml` (`[serve.static].plugins`), so a
 * Basis app's SASS and Markdown modules hot-reload in development.
 */
import { pluginServe } from '../libraries/bun-plugins/serve'

export { pluginGlobals } from '../libraries/bun-plugins/source/pluginGlobals'
export { pluginHmr } from '../libraries/bun-plugins/source/pluginHmr'
export { pluginMarkdown } from '../libraries/bun-plugins/source/pluginMarkdown'
export { pluginSASS } from '../libraries/bun-plugins/source/pluginSASS'

// eslint-disable-next-line @basis/no-default-export -- Bun's `[serve.static]` plugin loader requires a default export.
export default pluginServe
export { pluginServe }
