import { afterAll, expect } from 'bun:test'
import { closeBrowser } from '../browser'
import { toMatchScreenshot } from '../matchers/toMatchScreenshot'

expect.extend({ toMatchScreenshot })

afterAll(closeBrowser)
