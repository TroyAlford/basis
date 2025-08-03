// setup.ts
import { inspect } from 'node:util'

inspect.defaultOptions.depth = 2
inspect.defaultOptions.maxArrayLength = 10
inspect.defaultOptions.compact = false
