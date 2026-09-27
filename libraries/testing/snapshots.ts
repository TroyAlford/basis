import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

/**
 * Options controlling where a screenshot baseline lives and how it is compared.
 */
export interface ScreenshotOptions {
  /** Directory holding baselines and diff artifacts. Defaults to `<cwd>/__screenshots__`. */
  dir?: string,
  /** Maximum fraction of differing pixels allowed. When omitted, only the pixel budget applies. */
  maxDiffPixelRatio?: number,
  /** Maximum number of differing pixels allowed. Defaults to `0`. */
  maxDiffPixels?: number,
  /** Colour-distance threshold forwarded to pixelmatch. Defaults to `0.2`. */
  threshold?: number,
  /** Force-rewrite the baseline instead of comparing. Defaults to `UPDATE_SNAPSHOTS=1`. */
  update?: boolean,
}

/** Platform + architecture key, so local and CI baselines never collide. */
export const platformKey = `${process.platform}-${process.arch}`

/**
 * Resolve the directory that holds baselines and artifacts.
 * @param options - Screenshot options.
 * @returns The absolute baseline directory.
 */
export function screenshotDir(options: ScreenshotOptions = {}): string {
  return options.dir ?? join(process.cwd(), '__screenshots__')
}

/**
 * Resolve the baseline path for a named screenshot.
 * @param name - Screenshot name, relative to the baseline directory.
 * @param options - Screenshot options.
 * @returns The absolute baseline PNG path.
 */
export function screenshotPath(name: string, options: ScreenshotOptions = {}): string {
  return join(screenshotDir(options), `${name}.${platformKey}.png`)
}

/**
 * Resolve the path of an on-failure artifact.
 * @param name - Screenshot name.
 * @param kind - Whether this is the actual or the diff image.
 * @param options - Screenshot options.
 * @returns The absolute artifact PNG path.
 */
export function artifactPath(
  name: string,
  kind: 'actual' | 'diff',
  options: ScreenshotOptions = {},
): string {
  return join(screenshotDir(options), `${name}.${platformKey}.${kind}.png`)
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

/** Outcome of comparing an actual screenshot against its baseline. */
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
 * @param expected - Baseline image.
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
  const { maxDiffPixelRatio, maxDiffPixels = 0 } = options
  const pass = diffPixels <= maxDiffPixels
    && (maxDiffPixelRatio === undefined || ratio <= maxDiffPixelRatio)
  return { diff, diffPixels, pass, ratio, total }
}
