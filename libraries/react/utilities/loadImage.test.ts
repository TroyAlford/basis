import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { loadImage } from './loadImage'

/**
 * Creates a real `Image` whose `src` is captured instead of loaded, so the
 * mocked `onload`/`onerror` callbacks fully control the result. happy-dom loads
 * images for real and would otherwise fire `onerror` before the mock's timer.
 * @returns An image element with an inert `src` accessor.
 */
const createImage = (): HTMLImageElement => {
  const img = new Image()
  let source = ''
  Object.defineProperty(img, 'src', {
    configurable: true,
    get: () => source,
    set: (value: string) => { source = value },
  })
  return img
}

describe('loadImage', () => {
  let imageSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    imageSpy = spyOn(window, 'Image')
  })
  afterAll(() => {
    imageSpy.mockRestore()
  })

  test('resolves with image element on successful load', async () => {
    imageSpy.mockImplementation(() => {
      const img = createImage()
      setTimeout(() => img.onload?.(new Event('load')), 0)
      return img
    })

    const result = await loadImage('test.jpg')
    expect(result).toBeInstanceOf(Image)
    expect(result?.src).toContain('test.jpg')
  })

  test('resolves with null on failed load', async () => {
    imageSpy.mockImplementation(() => {
      const img = createImage()
      setTimeout(() => img.onerror?.(new Event('error')), 0)
      return img
    })

    const result = await loadImage('invalid.jpg')
    expect(result).toBeNull()
  })

  test('caches image loading promises', async () => {
    let callCount = 0
    imageSpy.mockImplementation(() => {
      callCount++
      const img = createImage()
      setTimeout(() => img.onload?.(new Event('load')), 0)
      return img
    })

    // Load the same image multiple times
    const promise1 = loadImage('cached-test.jpg')
    const promise2 = loadImage('cached-test.jpg')
    const promise3 = loadImage('cached-test.jpg')

    await Promise.all([promise1, promise2, promise3])

    // Should only create one Image instance due to caching
    expect(callCount).toBe(1)
  })
})
