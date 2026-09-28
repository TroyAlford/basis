import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

/**
 * Fraction of differing pixels tolerated when no explicit budget is given.
 *
 * Absorbs anti-aliasing noise between machines (for example arm64 vs x64 text
 * rendering) without hiding meaningful visual changes.
 */
export const DEFAULT_MAX_DIFF_PIXEL_RATIO = 0.001

/** Absolute number of differing pixels tolerated when no explicit budget is given. */
export const DEFAULT_MAX_DIFF_PIXELS = 10

/** Options controlling how a screenshot is captured and compared. */
export interface ScreenshotOptions {
  /**
   * Capture the entire scrollable page rather than just the viewport. Applies
   * to a Playwright page and defaults to `true`; set `false` for the viewport.
   * A locator is already its element's full box.
   */
  fullPage?: boolean,
  /** Maximum fraction of differing pixels allowed. Overrides the default tolerance. */
  maxDiffPixelRatio?: number,
  /** Maximum number of differing pixels allowed. When omitted, only the ratio budget applies. */
  maxDiffPixels?: number,
  /** Colour-distance threshold forwarded to pixelmatch. Defaults to `0.2`. */
  threshold?: number,
}

/**
 * Read and decode a PNG file.
 * @param path - Path to a PNG file.
 * @returns The decoded image.
 */
export function readPng(path: string): PNG {
  return PNG.sync.read(readFileSync(path))
}

/**
 * Encode and write a PNG file, creating parent directories as needed.
 * @param path - Destination path.
 * @param png - Image to write.
 */
export function writePng(path: string, png: PNG): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, PNG.sync.write(png))
}

/** Outcome of comparing an actual screenshot against its snapshot. */
export interface ScreenshotComparison {
  /** Image highlighting the differing pixels. */
  diff: PNG,
  /** Number of differing pixels. */
  diffPixels: number,
  /** Whether the difference is within tolerance. */
  pass: boolean,
  /** Fraction of differing pixels. */
  ratio: number,
  /** Total number of compared pixels. */
  total: number,
}

/**
 * Expand an image onto a transparent canvas of the requested size.
 * @param source - Image to expand.
 * @param width - Target width.
 * @param height - Target height.
 * @returns Either the source image or a padded copy.
 */
function pad(source: PNG, width: number, height: number): PNG {
  if (source.width === width && source.height === height) return source
  const canvas = new PNG({ height, width })
  source.bitblt(canvas, 0, 0, source.width, source.height, 0, 0)
  return canvas
}

/**
 * Compare two decoded PNGs with pixelmatch.
 * @param expected - Snapshot image.
 * @param actual - Captured image.
 * @param options - Comparison options.
 * @returns The comparison result, including the diff image.
 */
export function comparePng(
  expected: PNG,
  actual: PNG,
  options: ScreenshotOptions = {},
): ScreenshotComparison {
  const width = Math.max(expected.width, actual.width)
  const height = Math.max(expected.height, actual.height)
  const diff = new PNG({ height, width })
  const diffPixels = pixelmatch(
    pad(expected, width, height).data,
    pad(actual, width, height).data,
    diff.data,
    width,
    height,
    { threshold: options.threshold ?? 0.2 },
  )
  const total = width * height
  const ratio = total === 0 ? 0 : diffPixels / total
  const { maxDiffPixelRatio, maxDiffPixels } = options
  const hasBudget = maxDiffPixels !== undefined || maxDiffPixelRatio !== undefined
  const defaultBudget = Math.max(DEFAULT_MAX_DIFF_PIXELS, Math.ceil(total * DEFAULT_MAX_DIFF_PIXEL_RATIO))
  const pass = (maxDiffPixels === undefined || diffPixels <= maxDiffPixels)
    && (maxDiffPixelRatio === undefined || ratio <= maxDiffPixelRatio)
    && (hasBudget || diffPixels <= defaultBudget)
  return { diff, diffPixels, pass, ratio, total }
}
