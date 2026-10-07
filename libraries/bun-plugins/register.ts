import { plugin } from 'bun'
import { pluginHMR } from './source/pluginHMR'
import { pluginLESS } from './source/pluginLESS'
import { pluginMarkdown } from './source/pluginMarkdown'
import { pluginSASS } from './source/pluginSASS'

// Register all plugins automatically
plugin(pluginHMR())
plugin(pluginLESS())
plugin(pluginSASS())
plugin(pluginMarkdown())
