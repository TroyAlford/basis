import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Page } from 'playwright'
import { PNG } from 'pngjs'
import { commitScreenshot, runMatchScreenshot, runScreenshot } from './matchScreenshot'
import { slug } from './naming'
import { snapshotDirectory } from './snapshots'
import { updating } from './update'

const root = mkdtempSync(join(tmpdir(), 'basis-baseline-'))

afterAll(() => {
  rmSync(root, { force: true, recursive: true })
})

/**
 * Encode a 1x1 PNG of the given RGBA pixel.
 * @param rgba - The pixel channel values.
 * @returns The PNG bytes.
 */
function pixel(rgba: [number, number, number, number]): Buffer {
  const image = new PNG({ height: 1, width: 1 })
  image.data.set(rgba)
  return PNG.sync.write(image)
}

/**
 * Resolve the snapshot paths for a fixture file and key.
 * @param file - The fixture test file.
 * @param key - The snapshot key.
 * @returns The baseline and artifact paths.
 */
function paths(file: string, key: string): { actual: string, baseline: string, diff: string } {
  const directory = snapshotDirectory(file)
  const stem = slug(key)
  return {
    actual: join(directory, `${stem}.actual.png`),
    baseline: join(directory, `${stem}.png`),
    diff: join(directory, `${stem}.diff.png`),
  }
}

/**
 * Write a committed baseline, creating its directory.
 * @param baseline - The baseline path.
 * @param bytes - The baseline bytes.
 */
function writeBaseline(baseline: string, bytes: Buffer): void {
  mkdirSync(dirname(baseline), { recursive: true })
  writeFileSync(baseline, bytes)
}

describe('baseline protection', () => {
  test('leaves an existing baseline byte-for-byte unchanged on a comparison failure', () => {
    const file = join(root, 'comparison.test.ts')
    const key = 'renders 1'
    const { actual, baseline, diff } = paths(file, key)
    const original = pixel([255, 0, 0, 255])
    writeBaseline(baseline, original)

    const result = commitScreenshot(file, key, pixel([0, 255, 0, 255]), { maxDiffPixels: 0 }, false)

    expect(result.pass).toBe(false)
    expect(Buffer.compare(readFileSync(baseline), original)).toBe(0)
    expect(existsSync(actual)).toBe(true)
    expect(existsSync(diff)).toBe(true)
  })

  test('leaves an existing baseline unchanged and clears stale artifacts on a match', () => {
    const file = join(root, 'match.test.ts')
    const key = 'renders 1'
    const { actual, baseline, diff } = paths(file, key)
    const bytes = pixel([1, 2, 3, 255])
    writeBaseline(baseline, bytes)
    writeFileSync(actual, bytes)
    writeFileSync(diff, bytes)

    const result = commitScreenshot(file, key, bytes, {}, false)

    expect(result.pass).toBe(true)
    expect(Buffer.compare(readFileSync(baseline), bytes)).toBe(0)
    expect(existsSync(actual)).toBe(false)
    expect(existsSync(diff)).toBe(false)
  })

  test('rewrites an existing baseline only when updating', () => {
    const file = join(root, 'update.test.ts')
    const key = 'renders 1'
    const { baseline } = paths(file, key)
    const original = pixel([255, 0, 0, 255])
    writeBaseline(baseline, original)

    const unchanged = commitScreenshot(file, key, pixel([0, 0, 255, 255]), { maxDiffPixels: 0 }, false)
    expect(unchanged.pass).toBe(false)
    expect(Buffer.compare(readFileSync(baseline), original)).toBe(0)

    const next = pixel([0, 0, 255, 255])
    const changed = commitScreenshot(file, key, next, {}, true)
    expect(changed.pass).toBe(true)
    expect(Buffer.compare(readFileSync(baseline), next)).toBe(0)
  })

  test('leaves an existing baseline untouched when capture fails', async () => {
    const file = join(root, 'acquisition.test.ts')
    const key = 'acquisition 1'
    const { baseline } = paths(file, key)
    const original = pixel([255, 0, 0, 255])
    writeBaseline(baseline, original)

    const subject = { screenshot: async () => Buffer.alloc(0) } as unknown as Page

    await expect(runScreenshot(subject, 'acquisition', {}, {
      capture: async () => { throw new Error('browser unavailable') },
      file,
      key,
    })).rejects.toThrow('browser unavailable')

    expect(Buffer.compare(readFileSync(baseline), original)).toBe(0)
  })

  test('only updates when explicitly requested', () => {
    const previous = process.env.UPDATE_SNAPSHOTS
    delete process.env.UPDATE_SNAPSHOTS

    expect(updating()).toBe(process.argv.includes('--update-snapshots'))

    process.env.UPDATE_SNAPSHOTS = '1'
    expect(updating()).toBe(true)

    if (previous === undefined) delete process.env.UPDATE_SNAPSHOTS
    else process.env.UPDATE_SNAPSHOTS = previous
  })
})

/** A subject that passes the screenshot target check without a browser. */
const SUBJECT = { screenshot: async () => Buffer.alloc(0) } as unknown as Page

describe('matchScreenshot', () => {
  test('writes a missing baseline and resolves', async () => {
    const file = join(root, 'missing-baseline.test.ts')
    const key = 'renders 1'
    const { baseline } = paths(file, key)

    await runMatchScreenshot(SUBJECT, undefined, {}, {
      capture: async () => pixel([10, 20, 30, 255]),
      file,
      key,
    })

    expect(existsSync(baseline)).toBe(true)
  })

  test('resolves when the capture matches the committed baseline', async () => {
    const file = join(root, 'matching.test.ts')
    const key = 'renders 1'
    const { actual, baseline, diff } = paths(file, key)
    const bytes = pixel([1, 2, 3, 255])
    writeBaseline(baseline, bytes)
    writeFileSync(actual, bytes)
    writeFileSync(diff, bytes)

    await runMatchScreenshot(SUBJECT, undefined, {}, { capture: async () => bytes, file, key })

    expect(existsSync(actual)).toBe(false)
    expect(existsSync(diff)).toBe(false)
  })

  test('throws an AssertionError on mismatch and writes artifacts without mutating the baseline', async () => {
    const file = join(root, 'mismatch.test.ts')
    const key = 'renders 1'
    const { actual, baseline, diff } = paths(file, key)
    const original = pixel([255, 0, 0, 255])
    writeBaseline(baseline, original)

    const error = await runMatchScreenshot(SUBJECT, undefined, { maxDiffPixels: 0 }, {
      capture: async () => pixel([0, 255, 0, 255]),
      file,
      key,
    }).then(() => null, (thrown: unknown) => thrown as Error)

    expect(error).toBeInstanceOf(Error)
    expect(error?.name).toBe('AssertionError')
    expect(Buffer.compare(readFileSync(baseline), original)).toBe(0)
    expect(existsSync(actual)).toBe(true)
    expect(existsSync(diff)).toBe(true)
  })

  test('rewrites the baseline in update mode', async () => {
    const file = join(root, 'match-update.test.ts')
    const key = 'renders 1'
    const { baseline } = paths(file, key)
    const original = pixel([255, 0, 0, 255])
    const next = pixel([0, 0, 255, 255])
    writeBaseline(baseline, original)

    const previous = process.env.UPDATE_SNAPSHOTS
    process.env.UPDATE_SNAPSHOTS = '1'
    try {
      await runMatchScreenshot(SUBJECT, undefined, {}, { capture: async () => next, file, key })
    } finally {
      if (previous === undefined) delete process.env.UPDATE_SNAPSHOTS
      else process.env.UPDATE_SNAPSHOTS = previous
    }

    expect(Buffer.compare(readFileSync(baseline), next)).toBe(0)
  })

  test('rejects with the capture error and leaves the baseline untouched', async () => {
    const file = join(root, 'capture-failure.test.ts')
    const key = 'renders 1'
    const { baseline } = paths(file, key)
    const original = pixel([255, 0, 0, 255])
    writeBaseline(baseline, original)

    await expect(runMatchScreenshot(SUBJECT, undefined, {}, {
      capture: async () => { throw new Error('browser unavailable') },
      file,
      key,
    })).rejects.toThrow('browser unavailable')

    expect(Buffer.compare(readFileSync(baseline), original)).toBe(0)
  })

  test('throws for an unsupported subject', async () => {
    await expect(runMatchScreenshot(undefined as never, undefined, {}, {
      file: join(root, 'invalid.test.ts'),
      key: 'renders 1',
    })).rejects.toThrow('expected a React element')
  })
})
