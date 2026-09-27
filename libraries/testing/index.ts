import { test } from 'bun:test'
import type { ScreenshotOptions } from './snapshots'

export { closeBrowser, getBrowser, newPage } from './browser'
export type { PageOptions } from './browser'
export { toMatchScreenshot } from './matchers/toMatchScreenshot'
export type { MatcherResult, ScreenshotTarget } from './matchers/toMatchScreenshot'
export {
  artifactPath,
  comparePng,
  platformKey,
  readPng,
  screenshotDir,
  screenshotPath,
  writePng,
} from './snapshots'
export type { ScreenshotComparison, ScreenshotOptions } from './snapshots'

/** Whether browser-backed visual tests are enabled for this run (`VISUAL=1`). */
export const visualEnabled = process.env.VISUAL === '1'

/**
 * Register a test that only runs when visual testing is enabled.
 *
 * `bun test` skips these unless `VISUAL=1`; CI sets it after installing a
 * browser, and a machine without a browser is never blocked by them.
 * @param name - Test name.
 * @param fn - Test body.
 */
export function visualTest(name: string, fn: () => unknown): void {
  const body: () => void = fn
  if (visualEnabled) test(name, body)
  else test.skip(name, body)
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      /**
       * Assert that a Playwright page or locator matches a committed baseline.
       * @param name - Screenshot name.
       * @param options - Screenshot and comparison options.
       * @returns The matcher result.
       */
      toMatchScreenshot(name: string, options?: ScreenshotOptions): Promise<R>,
    }
  }
}
