import { afterAll, expect } from 'bun:test'
import { stopApplications } from './application'
import { closeBrowser } from './browser'
import { pruneSnapshots } from './cleanup'
import { toMatchScreenshot } from './matchers/toMatchScreenshot'

import './happydom'
import '../react/testing/bun/register'

expect.extend({ toMatchScreenshot })

afterAll(() => { pruneSnapshots() })
afterAll(stopApplications)
afterAll(closeBrowser)

/**
 * Stop run-scoped application servers, then exit, when the run is interrupted.
 * @param code - The exit code to report after teardown.
 */
const onSignal = (code: number): void => {
  void stopApplications().finally(() => process.exit(code))
}

process.once('SIGINT', () => onSignal(130))
process.once('SIGTERM', () => onSignal(143))
