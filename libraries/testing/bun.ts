import { afterAll, expect } from 'bun:test'
import { closeBrowser } from './browser'
import { pruneSnapshots } from './cleanup'
import { toMatchScreenshot } from './matchers/toMatchScreenshot'

import './happydom'
import '../react/testing/bun/register'

expect.extend({ toMatchScreenshot })

afterAll(() => { pruneSnapshots() })
afterAll(closeBrowser)
