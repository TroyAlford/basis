import { afterAll, expect } from 'bun:test'
import { closeBrowser } from './browser'
import { toMatchScreenshot } from './matchers/toMatchScreenshot'

import './happydom'
import '../react/testing/bun'

expect.extend({ toMatchScreenshot })

afterAll(closeBrowser)
