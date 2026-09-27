import { describe, expect, test } from 'bun:test'
import { PNG } from 'pngjs'
import { artifactPath, comparePng, platformKey, screenshotPath } from './snapshots'

/**
 * Build a solid-colour PNG for comparison tests.
 * @param width - Image width.
 * @param height - Image height.
 * @param color - RGB colour.
 * @returns The encoded image.
 */
function solid(width: number, height: number, color: [number, number, number]): PNG {
  const png = new PNG({ height, width })
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = color[0]
    png.data[offset + 1] = color[1]
    png.data[offset + 2] = color[2]
    png.data[offset + 3] = 255
  }
  return png
}

describe('testing/snapshots', () => {
  test('keys baselines and artifacts by platform and architecture', () => {
    expect(screenshotPath('a/b', { dir: '/tmp/x' })).toBe(`/tmp/x/a/b.${platformKey}.png`)
    expect(artifactPath('a/b', 'diff', { dir: '/tmp/x' })).toBe(
      `/tmp/x/a/b.${platformKey}.diff.png`,
    )
  })

  test('passes identical images', () => {
    const result = comparePng(solid(4, 4, [255, 0, 0]), solid(4, 4, [255, 0, 0]))
    expect(result.pass).toBe(true)
    expect(result.diffPixels).toBe(0)
  })

  test('fails differing images and reports the delta', () => {
    const result = comparePng(solid(4, 4, [255, 0, 0]), solid(4, 4, [0, 255, 0]))
    expect(result.pass).toBe(false)
    expect(result.diffPixels).toBe(16)
    expect(result.ratio).toBe(1)
  })

  test('tolerates differences within the configured budget', () => {
    const expected = solid(4, 4, [255, 0, 0])
    const actual = solid(4, 4, [255, 0, 0])
    actual.data[0] = 0
    actual.data[1] = 255

    expect(comparePng(expected, actual).pass).toBe(false)
    expect(comparePng(expected, actual, { maxDiffPixels: 1 }).pass).toBe(true)
  })
})
