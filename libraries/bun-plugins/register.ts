import { plugin } from 'bun'
import { pluginHMR } from './source/pluginHMR'
import { pluginLESS } from './source/pluginLESS'
import { pluginSASS } from './source/pluginSASS'

// Register all plugins automatically
plugin(pluginHMR())
plugin(pluginLESS())
plugin(pluginSASS())
