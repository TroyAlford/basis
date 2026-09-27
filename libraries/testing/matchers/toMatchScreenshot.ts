import { existsSync, readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import type { ScreenshotOptions } from '../snapshots'
import { artifactPath, comparePng, readPng, screenshotPath, writePng } from '../snapshots'

/** Anything Playwright can screenshot: a `Page` or a `Locator`. */
export interface ScreenshotTarget {
  /** Capture a PNG screenshot. */
  screenshot(options?: Record<string, unknown>): Promise<Buffer | string>,
}

/** Result returned by the {@link toMatchScreenshot} matcher. */
export interface MatcherResult {
  /** Human-readable success or failure message. */
  message: () => string,
  /** Whether the assertion passed. */
  pass: boolean,
}

/**
 * Coerce a Playwright screenshot result into a Buffer.
 * @param result - A PNG buffer or a path to one.
 * @returns The PNG bytes.
 */
function toBuffer(result: Buffer | string): Buffer {
  return typeof result === 'string' ? readFileSync(result) : result
}

/**
 * Assert that a Playwright page or locator matches a committed baseline PNG.
 *
 * A missing (or `UPDATE_SNAPSHOTS=1`) baseline is written and the assertion
 * passes; a differing capture fails and writes `*.actual.png` / `*.diff.png`
 * artifacts next to the baseline.
 * @param received - A Playwright `Page` or `Locator`.
 * @param name - Screenshot name, relative to the baseline directory.
 * @param options - Screenshot and comparison options.
 * @returns The matcher result.
 */
export async function toMatchScreenshot(
  received: ScreenshotTarget,
  name: string,
  options: ScreenshotOptions = {},
): Promise<MatcherResult> {
  if (typeof received?.screenshot !== 'function') {
    return {
      message: () => 'toMatchScreenshot: received value must be a Playwright Page or Locator',
      pass: false,
    }
  }

  const buffer = toBuffer(await received.screenshot({ animations: 'disabled', caret: 'hide' }))
  const actual = PNG.sync.read(buffer)
  const baseline = screenshotPath(name, options)
  const update = options.update ?? process.env.UPDATE_SNAPSHOTS === '1'

  if (update || !existsSync(baseline)) {
    writePng(baseline, actual)
    return { message: () => `toMatchScreenshot: wrote baseline ${baseline}`, pass: true }
  }

  const comparison = comparePng(readPng(baseline), actual, options)
  if (comparison.pass) {
    return { message: () => `toMatchScreenshot: matches ${baseline}`, pass: true }
  }

  const actualPath = artifactPath(name, 'actual', options)
  const diffPath = artifactPath(name, 'diff', options)
  writePng(actualPath, actual)
  writePng(diffPath, comparison.diff)

  return {
    message: () => [
      `toMatchScreenshot: "${name}" differs from ${baseline}`,
      `${comparison.diffPixels}/${comparison.total} pixels ` +
        `(${(comparison.ratio * 100).toFixed(2)}%) differ`,
      `actual: ${actualPath}`,
      `diff:   ${diffPath}`,
    ].join('\n'),
    pass: false,
  }
}
