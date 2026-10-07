import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { PNG } from 'pngjs'
import type * as React from 'react'
import { withCapturePage } from './browser'
import { callerFile } from './caller'
import { trackSnapshot } from './cleanup'
import { renderHtml } from './document'
import { formatSnapshotKey, slug } from './naming'
import type { ScreenshotOptions } from './snapshots'
import { comparePng, readPng, snapshotDirectory, writePng, writePngBytes } from './snapshots'
import { currentTestName, nextSnapshotIndex } from './test'
import { updating } from './update'

/** Result returned by {@link runScreenshot} and {@link commitScreenshot}. */
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
 * @returns The caller's file path, or a synthetic path when it cannot be found.
 */
function resolvedCallerFile(): string {
  return callerFile() ?? join(process.cwd(), 'snapshot.test.ts')
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
  const dir = snapshotDirectory(file)
  const stem = slug(key)
  return {
    actual: join(dir, `${stem}.actual.png`),
    baseline: join(dir, `${stem}.png`),
    diff: join(dir, `${stem}.diff.png`),
  }
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
    '[basis/testing] matchScreenshot was used outside a test registered via ' +
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
 * Wait until the page has loaded its fonts.
 *
 * A capture would otherwise race a webfont that applies after first paint,
 * committing the fallback (for example, blank glyphs). `fonts.ready` resolves
 * once in-flight loads settle, and a failed load counts, so a blocked font
 * cannot hang the matcher.
 * @param target - The page or locator whose page to wait on.
 */
async function waitForFonts(target: Page | Locator): Promise<void> {
  const ready = async () => {
    await document.fonts.ready
  }

  if (isPage(target)) {
    await target.evaluate(ready)
  } else {
    await target.evaluate(ready)
  }
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
    await waitForFonts(subject)
    const shot = await screenshotWithRetry(() => subject.screenshot({
      animations: 'disabled',
      caret: 'hide',
      ...(isPage(subject) ? { fullPage: options.fullPage ?? true } : {}),
    }))
    return Buffer.isBuffer(shot) ? shot : Buffer.from(shot)
  }

  const html = renderHtml(subject)
  return await withCapturePage(async page => {
    await page.setContent(html, { waitUntil: 'load' })
    /*
     * Await fonts and measure in one round-trip. Playwright calls made from
     * inside a Bun matcher are comparatively expensive, so the element capture
     * keeps them to the minimum: one evaluate, then one screenshot.
     */
    const clip = await page.evaluate(async () => {
      await document.fonts.ready
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
 * Apply a captured screenshot against the committed baseline for a key.
 *
 * This is the only place the matcher writes to disk. An existing baseline is
 * replaced only when `update` is true (`--update-snapshots` /
 * `UPDATE_SNAPSHOTS=1`); a comparison failure writes `*.actual.png` /
 * `*.diff.png` artifacts beside the baseline and never touches the baseline
 * itself. A failed or browser-less run therefore cannot mutate committed
 * snapshots. Exported so tests can prove that guarantee without a browser.
 * @param file - The calling test file.
 * @param key - The snapshot key.
 * @param bytes - The captured PNG bytes.
 * @param options - Comparison options.
 * @param update - Whether to rewrite the baseline. Defaults to {@link updating}.
 * @returns The matcher result.
 */
export function commitScreenshot(
  file: string,
  key: string,
  bytes: Buffer,
  options: ScreenshotOptions = {},
  update = updating(),
): MatcherResult {
  const { actual: actualPath, baseline, diff: diffPath } = snapshotPaths(file, key)

  if (update || !existsSync(baseline)) {
    writePngBytes(baseline, bytes)
    return { message: () => `matchScreenshot: wrote ${baseline}`, pass: true }
  }

  // Identical bytes are identical pixels; skip the decode and the pixel diff.
  if (readFileSync(baseline).equals(bytes)) {
    rmSync(actualPath, { force: true })
    rmSync(diffPath, { force: true })
    return { message: () => `matchScreenshot: matches ${baseline}`, pass: true }
  }

  const actual = PNG.sync.read(bytes)
  const comparison = comparePng(readPng(baseline), actual, options)
  if (comparison.pass) {
    /*
     * A passing comparison supersedes any artifacts a previous failing run
     * left beside the snapshot.
     */
    rmSync(actualPath, { force: true })
    rmSync(diffPath, { force: true })
    return { message: () => `matchScreenshot: matches ${baseline}`, pass: true }
  }

  writePng(actualPath, actual)
  writePng(diffPath, comparison.diff)

  return {
    message: () => [
      `matchScreenshot: "${key}" differs from ${baseline}`,
      `${comparison.diffPixels}/${comparison.total} pixels ` +
        `(${(comparison.ratio * 100).toFixed(2)}%) differ`,
      `actual: ${actualPath}`,
      `diff:   ${diffPath}`,
    ].join('\n'),
    pass: false,
  }
}

/**
 * Injectable seams for {@link runScreenshot}, used by tests to prove the
 * baseline-mutation guarantees without a browser.
 */
interface ScreenshotRun {
  /** Capture implementation. Defaults to the Playwright/render capture. */
  capture?: (subject: ScreenshotSubject, options: ScreenshotOptions) => Promise<Buffer>,
  /** Calling test file. Defaults to the stack-derived caller. */
  file?: string,
  /** Snapshot key. Defaults to the test-name-derived key. */
  key?: string,
}

/**
 * Run one screenshot assertion: validate, mark the baseline in scope, capture,
 * then compare or write.
 *
 * The baseline is tracked before capture so a capture failure cannot make it
 * look orphaned, and nothing is written until capture returns bytes.
 * @param received - The subject to capture.
 * @param hint - Optional hint; the snapshot is keyed by test name and hint.
 * @param options - Comparison options.
 * @param run - Injectable seams. Tests only.
 * @returns The matcher result.
 */
export async function runScreenshot(
  received: ScreenshotSubject,
  hint?: string,
  options: ScreenshotOptions = {},
  run: ScreenshotRun = {},
): Promise<MatcherResult> {
  if (
    !received
    || typeof received !== 'object'
    || (!('type' in received) && !isScreenshotTarget(received))
  ) {
    return {
      message: () => 'matchScreenshot: expected a React element, Playwright page, or locator',
      pass: false,
    }
  }

  const file = run.file ?? resolvedCallerFile()
  const key = run.key ?? snapshotKey(file, hint)

  /*
   * Track the baseline before capturing: if acquisition fails, the baseline
   * must be treated as in scope (protected from pruning) rather than stale.
   */
  trackSnapshot(snapshotPaths(file, key).baseline)
  const bytes = await (run.capture ?? capture)(received, options)
  return commitScreenshot(file, key, bytes, options)
}

/**
 * Run the screenshot assertion with injectable seams.
 *
 * Internal: the public {@link matchScreenshot} is exactly three arguments, and
 * the behavior tests inject their capture here. Not re-exported from
 * `basis/testing`.
 * @param subject - The subject to capture.
 * @param hint - Optional hint; the snapshot is keyed by test name and hint.
 * @param options - Comparison options.
 * @param run - Injectable seams. Tests only.
 * @returns Resolves on a match or a written baseline; throws otherwise.
 */
export async function runMatchScreenshot(
  subject: ScreenshotSubject,
  hint?: string,
  options: ScreenshotOptions = {},
  run: ScreenshotRun = {},
): Promise<void> {
  const result = await runScreenshot(subject, hint, options, run)
  if (result.pass) return

  const error = new Error(result.message())
  error.name = 'AssertionError'
  throw error
}

/**
 * Assert that a subject matches its committed screenshot.
 *
 * Mirrors `toMatchSnapshot`: when no snapshot exists (or `--update-snapshots` /
 * `UPDATE_SNAPSHOTS=1` is set) the capture is written and the call resolves;
 * otherwise the capture is compared and a mismatch throws, writing
 * `*.actual.png` / `*.diff.png` artifacts beside the snapshot. An existing
 * baseline is never written unless updating, and a capture failure (for example
 * a missing browser) leaves every baseline untouched.
 *
 * This is an ordinary async function rather than an `expect.extend` matcher on
 * purpose: Bun drives async matchers synchronously on its event loop, which
 * makes the Playwright calls inside them dramatically slower than the identical
 * calls awaited normally.
 * @param subject - The subject to capture: a React element, Playwright page, or locator.
 * @param hint - Optional hint; the snapshot is keyed by test name and hint.
 * @param options - Comparison options.
 * @returns Resolves on a match or a written baseline; throws otherwise.
 */
export async function matchScreenshot(
  subject: ScreenshotSubject,
  hint?: string,
  options: ScreenshotOptions = {},
): Promise<void> {
  await runMatchScreenshot(subject, hint, options)
}
