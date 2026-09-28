import type { ScreenshotOptions } from './snapshots'

export { startApplication } from './application'
export type { ApplicationHandle, StartApplicationOptions } from './application'
export { withPage } from './browser'
export type { PageOptions, Viewport } from './browser'
export { blockExternalRequests, stubRequest } from './network'
export type { BlockExternalOptions, StubOptions } from './network'
export { seedLocalStorage } from './state'
export { render } from '../react/testing/render'
export { Simulate } from '../react/testing/Simulate'
export { waitFor } from '../react/testing/waitFor'
export { describe, it, test } from './test'
export { toMatchScreenshot } from './matchers/toMatchScreenshot'
export type { MatcherResult, ScreenshotSubject } from './matchers/toMatchScreenshot'
export { comparePng } from './snapshots'
export type { ScreenshotComparison, ScreenshotOptions } from './snapshots'

declare module 'bun:test' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<T> {
    /**
     * Assert that a React element, Playwright page, or locator matches a
     * committed PNG snapshot.
     * @param hint - Optional hint; the snapshot is keyed by test name and hint.
     * @param options - Comparison options.
     * @returns A promise that resolves when the assertion completes.
     */
    toMatchScreenshot(hint?: string, options?: ScreenshotOptions): Promise<void>,
  }
}
