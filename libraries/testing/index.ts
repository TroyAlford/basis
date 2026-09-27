import type { ScreenshotOptions } from './snapshots'

export { render } from '../react/testing/render'
export { Simulate } from '../react/testing/Simulate'
export { waitFor } from '../react/testing/waitFor'
export { describe, it, test } from './test'
export { toMatchScreenshot } from './matchers/toMatchScreenshot'
export type { MatcherResult } from './matchers/toMatchScreenshot'
export { comparePng } from './snapshots'
export type { ScreenshotComparison, ScreenshotOptions } from './snapshots'

declare module 'bun:test' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<T> {
    /**
     * Assert that a rendered React element matches a committed PNG snapshot.
     * @param hint - Optional hint; the snapshot is keyed by test name and hint.
     * @param options - Comparison options.
     * @returns A promise that resolves when the assertion completes.
     */
    toMatchScreenshot(hint?: string, options?: ScreenshotOptions): Promise<void>,
  }
}
