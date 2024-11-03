import { describe, expect, test } from 'bun:test'
import { loadImage } from './loadImage'

describe('loadImage', () => {
  test('resolves with image element on successful load', async () => {
    // Mock successful image load
    const WindowImage = window.Image

    window.Image = class extends WindowImage {
      constructor() {
        super()
        setTimeout(() => this.onload?.(null), 0)
      }
    }

    const result = await loadImage('test.jpg')
    expect(result).toBeInstanceOf(window.Image)
    expect(result.src).toContain('test.jpg')

    // Restore original Image constructor
    window.Image = WindowImage
  })

  test('rejects with error on failed load', async () => {
    // Mock failed image load
    const WindowImage = window.Image

    window.Image = class extends WindowImage {
      constructor() {
        super()
        setTimeout(() => this.onerror?.(null), 0)
      }
    }

    await expect(loadImage('invalid.jpg')).rejects.toThrow('Failed to load image: invalid.jpg')

    // Restore original Image constructor
    window.Image = WindowImage
  })

  test('sets src property on image element', () => {
    const WindowImage = window.Image
    let createdImage: HTMLImageElement | null = null

    window.Image = class extends WindowImage {
      constructor() {
        super()
        createdImage = this // eslint-disable-line @typescript-eslint/no-this-alias
      }
    }

    loadImage('test.jpg')
    expect(createdImage?.src).toContain('test.jpg')

    // Restore original Image constructor
    window.Image = WindowImage
  })
})
