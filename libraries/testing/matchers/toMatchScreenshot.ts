import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { PNG } from 'pngjs'
import type * as React from 'react'
import { withPage } from '../browser'
import { renderHtml } from '../document'
import { formatSnapshotKey, slug } from '../naming'
import type { ScreenshotOptions } from '../snapshots'
import { comparePng, readPng, writePng } from '../snapshots'
import { currentTestName, nextSnapshotIndex } from '../test'

/** Result returned by the {@link toMatchScreenshot} matcher. */
export interface MatcherResult {
  /** Human-readable success or failure message. */
  message: () => string,
  /** Whether the assertion passed. */
  pass: boolean,
}

/** Anything the matcher can capture: a React element or a Playwright target. */
export type ScreenshotSubject = React.ReactElement | Page | Locator

/**
 * Whether a value is a Playwright screenshot target (a `Page` or `Locator`).
 * @param value - The candidate subject.
 * @returns True when the value exposes Playwright's `screenshot`.
 */
function isScreenshotTarget(value: ScreenshotSubject): value is Page | Locator {
  return typeof (value as { screenshot?: unknown }).screenshot === 'function'
}

/**
 * Whether a Playwright target is a page (as opposed to a locator).
 * @param value - The target.
 * @returns True for a page.
 */
function isPage(value: Page | Locator): value is Page {
  return typeof (value as Page).goto === 'function'
}

/** Paths a snapshot and its failure artifacts resolve to. */
interface SnapshotPaths {
  /** Captured image, written on a mismatch. */
  actual: string,
  /** Committed snapshot. */
  baseline: string,
  /** Diff image, written on a mismatch. */
  diff: string,
}

/**
 * Resolve the test file that invoked the matcher.
 *
 * Bun exposes no test-path API to custom matchers (there is no
 * `expect.getState()`), so the calling frame is read from the stack; frames from
 * `node_modules` and non-test files are skipped.
 * @returns The caller's file path, or a synthetic path when it cannot be found.
 */
function callerFile(): string {
  const stack = new Error().stack ?? ''
  for (const line of stack.split('\n')) {
    const match = line.match(/\(?((?:\/|file:\/\/)[^()\s]+?):\d+:\d+\)?$/)
    if (!match) continue
    const file = match[1].replace(/^file:\/\//, '')
    if (file.includes('node_modules')) continue
    if (!/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)) continue
    return file
  }
  return join(process.cwd(), 'snapshot.test.ts')
}

/**
 * Resolve the snapshot and artifact paths for a snapshot key.
 *
 * Mirrors Bun's snapshot layout: one directory per test file, here
 * `__screenshots__/<test file>/`, with the key as the filename.
 * @param file - The calling test file.
 * @param key - The snapshot key.
 * @returns The snapshot and artifact paths.
 */
function snapshotPaths(file: string, key: string): SnapshotPaths {
  const dir = join(dirname(file), '__screenshots__', basename(file))
  const stem = slug(key)
  return {
    actual: join(dir, `${stem}.actual.png`),
    baseline: join(dir, `${stem}.png`),
    diff: join(dir, `${stem}.diff.png`),
  }
}

/**
 * Whether snapshots should be rewritten instead of compared.
 * @returns True when `--update-snapshots` or `UPDATE_SNAPSHOTS=1` is set.
 */
function updating(): boolean {
  return process.argv.includes('--update-snapshots') || process.env.UPDATE_SNAPSHOTS === '1'
}

let warnedMissingTestName = false

/**
 * Warn once when a snapshot is taken outside a test registered through the
 * wrapped `test`/`describe`, since the key then omits the test name.
 */
function warnMissingTestName(): void {
  if (warnedMissingTestName) return
  warnedMissingTestName = true
  process.stderr.write(
    '[basis/testing] toMatchScreenshot was used outside a test registered via ' +
      "basis/testing's test/describe; the snapshot key will omit the test name\n",
  )
}

/**
 * Build the snapshot key from the current test name, an optional hint, and the
 * per-key counter — the same shape as Bun's own snapshot keys.
 * @param file - The calling test file.
 * @param hint - An optional hint disambiguating multiple snapshots.
 * @returns The snapshot key.
 */
function snapshotKey(file: string, hint?: string): string {
  const testName = currentTestName()
  if (!testName) warnMissingTestName()
  const resolved = testName ?? 'screenshot'
  const index = nextSnapshotIndex(`${file}#${resolved}#${hint ?? ''}`)
  return formatSnapshotKey(resolved, hint, index)
}

/**
 * Run a screenshot action, retrying the transient capture failures Chromium
 * occasionally reports in headless runs.
 * @param action - The screenshot action.
 * @param attempts - Maximum attempts. Defaults to 3.
 * @returns The action's result.
 */
async function screenshotWithRetry<T>(action: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      await Bun.sleep(100 * (attempt + 1))
    }
  }
  throw lastError
}

/**
 * Capture a subject to a PNG buffer.
 *
 * A Playwright page or locator is screenshotted directly (a locator is cropped
 * to its element); a React element is rendered to a standalone document and
 * cropped to its content.
 * @param subject - What to capture.
 * @param options - Capture options.
 * @returns The PNG bytes.
 */
async function capture(subject: ScreenshotSubject, options: ScreenshotOptions): Promise<Buffer> {
  if (isScreenshotTarget(subject)) {
    const shot = await screenshotWithRetry(() => subject.screenshot({
      animations: 'disabled',
      caret: 'hide',
      ...(isPage(subject) ? { fullPage: options.fullPage ?? true } : {}),
    }))
    return Buffer.isBuffer(shot) ? shot : Buffer.from(shot)
  }

  const html = renderHtml(subject)
  return await withPage(async page => {
    await page.setContent(html, { waitUntil: 'load' })
    const clip = await page.evaluate(() => {
      const rects = Array.from(document.body.children, element => element.getBoundingClientRect())
      if (rects.length === 0) return null
      const left = Math.floor(Math.min(...rects.map(rect => rect.left)))
      const top = Math.floor(Math.min(...rects.map(rect => rect.top)))
      const right = Math.ceil(Math.max(...rects.map(rect => rect.right)))
      const bottom = Math.ceil(Math.max(...rects.map(rect => rect.bottom)))
      return { height: bottom - top, width: right - left, x: left, y: top }
    })
    return await screenshotWithRetry(() => page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      ...(clip ? { clip } : { fullPage: true }),
    }))
  })
}

/**
 * Assert that a subject matches a committed PNG snapshot.
 *
 * Mirrors `toMatchSnapshot`: when no snapshot exists (or `--update-snapshots` /
 * `UPDATE_SNAPSHOTS=1` is set) the capture is written and the assertion passes;
 * otherwise the capture is compared and a mismatch fails, writing
 * `*.actual.png` / `*.diff.png` artifacts beside the snapshot.
 * @param received - The subject to capture: a React element, Playwright page, or locator.
 * @param hint - Optional hint; the snapshot is keyed by test name and hint.
 * @param options - Comparison options.
 * @returns The matcher result.
 */
export async function toMatchScreenshot(
  received: ScreenshotSubject,
  hint?: string,
  options: ScreenshotOptions = {},
): Promise<MatcherResult> {
  if (
    !received
    || typeof received !== 'object'
    || (!('type' in received) && !isScreenshotTarget(received))
  ) {
    return {
      message: () => 'toMatchScreenshot: expected a React element, Playwright page, or locator',
      pass: false,
    }
  }

  const file = callerFile()
  const key = snapshotKey(file, hint)
  const actual = PNG.sync.read(await capture(received, options))
  const { actual: actualPath, baseline, diff: diffPath } = snapshotPaths(file, key)

  if (!existsSync(baseline) || updating()) {
    writePng(baseline, actual)
    return { message: () => `toMatchScreenshot: wrote ${baseline}`, pass: true }
  }

  const comparison = comparePng(readPng(baseline), actual, options)
  if (comparison.pass) {
    return { message: () => `toMatchScreenshot: matches ${baseline}`, pass: true }
  }

  writePng(actualPath, actual)
  writePng(diffPath, comparison.diff)

  return {
    message: () => [
      `toMatchScreenshot: "${key}" differs from ${baseline}`,
      `${comparison.diffPixels}/${comparison.total} pixels ` +
        `(${(comparison.ratio * 100).toFixed(2)}%) differ`,
      `actual: ${actualPath}`,
      `diff:   ${diffPath}`,
    ].join('\n'),
    pass: false,
  }
}
