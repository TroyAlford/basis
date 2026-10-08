import { plugin } from 'bun'
import { pluginLESS } from './source/pluginLESS'
import { pluginMarkdown } from './source/pluginMarkdown'
import { pluginSASS } from './source/pluginSASS'

// Register all plugins automatically
plugin(pluginLESS())
plugin(pluginSASS())
plugin(pluginMarkdown())
