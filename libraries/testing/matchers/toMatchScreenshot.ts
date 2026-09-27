import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { PNG } from 'pngjs'
import type * as React from 'react'
import { withPage } from '../browser'
import { renderHtml } from '../document'
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
 * Turn a snapshot key into a filesystem-safe, lowercase name.
 * @param value - The snapshot key.
 * @returns A kebab-cased filename stem.
 */
function slug(value: string): string {
  return value
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'snapshot'
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

/**
 * Build the snapshot key from the current test name, an optional hint, and the
 * per-key counter — the same shape as Bun's own snapshot keys.
 * @param file - The calling test file.
 * @param hint - An optional hint disambiguating multiple snapshots.
 * @returns The snapshot key.
 */
function snapshotKey(file: string, hint?: string): string {
  const testName = currentTestName() ?? 'screenshot'
  const base = hint ? `${testName}: ${hint}` : testName
  const index = nextSnapshotIndex(`${file}#${testName}#${hint ?? ''}`)
  return `${base} ${index}`
}

/**
 * Assert that a rendered React element matches a committed PNG snapshot.
 *
 * Mirrors `toMatchSnapshot`: when no snapshot exists (or `--update-snapshots` /
 * `UPDATE_SNAPSHOTS=1` is set) the capture is written and the assertion passes;
 * otherwise the capture is compared and a mismatch fails, writing
 * `*.actual.png` / `*.diff.png` artifacts beside the snapshot.
 * @param received - The React element to render and capture.
 * @param hint - Optional hint; the snapshot is keyed by test name and hint.
 * @param options - Comparison options.
 * @returns The matcher result.
 */
export async function toMatchScreenshot(
  received: React.ReactElement,
  hint?: string,
  options: ScreenshotOptions = {},
): Promise<MatcherResult> {
  if (!received || typeof received !== 'object' || !('type' in received)) {
    return { message: () => 'toMatchScreenshot: expected a React element', pass: false }
  }

  const file = callerFile()
  const key = snapshotKey(file, hint)
  const html = renderHtml(received)
  const buffer = await withPage(async page => {
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
    return await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      ...(clip ? { clip } : { fullPage: true }),
    })
  })
  const actual = PNG.sync.read(buffer)
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
