import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Image } from '../Image/Image'
import { Carousel } from './Carousel'

describe('Carousel', () => {
  const images = ['test1.jpg', 'test2.jpg', 'test3.jpg']

  // Clear image cache before each test
  beforeEach(() => {
    Image.Cache.Loading.clear()
    Image.Cache.Resolved.clear()
  })

  // Clear image cache after all tests
  afterAll(() => {
    Image.Cache.Loading.clear()
    Image.Cache.Resolved.clear()
  })

  // Simplified helper that just sets cache values
  const simulateImageLoad = (src: string) => {
    const img = new window.Image()
    img.src = src
    Image.Cache.Loading.delete(src)
    Image.Cache.Resolved.set(src, img)
  }

  describe('initialization', () => {
    test('renders with default props', () => {
      const { node } = render(<Carousel />)
      expect(node).toHaveClass('carousel')
      expect(node.dataset.size).toBe(Carousel.Size.Contain)
      expect(node.dataset.align).toBe(Carousel.Align.Center)
    })

    test('accepts string image URLs', () => {
      simulateImageLoad('test1.jpg')
      const { node } = render(<Carousel images={images} />)

      const img = node.querySelector<HTMLImageElement>('img.image.component')
      expect(img?.src).toContain('test1.jpg')
    })

    test('accepts image config objects', async () => {
      const { node } = render(
        <Carousel
          images={[{
            align: Carousel.Align.NorthWest,
            size: Carousel.Size.Fill,
            url: 'test.jpg',
          }]}
        />,
      )
      await simulateImageLoad('test.jpg')
      expect(node.dataset.align).toBe('nw')
      expect(node.dataset.size).toBe('fill')
    })
  })

  describe('navigation', () => {
    test('cycles through images with next/prev', async () => {
      const { instance, node } = render<Carousel>(<Carousel images={images} />)

      // Pre-load all images
      for (const src of images) {
        await simulateImageLoad(src)
      }

      const img = node.querySelector('img')

      instance.next()
      expect(img?.src).toContain('test2.jpg')

      instance.next()
      expect(img?.src).toContain('test3.jpg')

      instance.next()
      expect(img?.src).toContain('test1.jpg')

      instance.prev()
      expect(img?.src).toContain('test3.jpg')
    })

    test('calls onImageChange callback', async () => {
      const onImageChange = mock()
      const { instance } = render<Carousel>(
        <Carousel images={images} onImageChange={onImageChange} />,
      )
      await simulateImageLoad('test1.jpg')

      instance.next()
      expect(onImageChange).toHaveBeenCalledWith(1)
    })
  })

  describe('lightbox', () => {
    test('opens lightbox on image click', () => {
      const { node } = render(<Carousel images={images} />)
      const img = node.querySelector('img')

      img?.click()
      expect(node.dataset.lightbox).toBe('true')
    })

    test('closes lightbox on background click', () => {
      const { node } = render(<Carousel images={images} />)
      const img = node.querySelector('img')

      img?.click()
      const lightbox = document.querySelector('.carousel.component.lightbox')
      lightbox?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(node.dataset.lightbox).toBe('false')
    })

    test('closes lightbox with escape key', () => {
      const { node } = render(<Carousel images={images} />)
      const img = node.querySelector('img')

      img?.click()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(node.dataset.lightbox).toBe('false')
    })
  })

  describe('keyboard navigation', () => {
    test('responds to arrow keys when focused', async () => {
      const { node } = render(<Carousel images={images} />)

      // Pre-load images
      await simulateImageLoad('test1.jpg')
      await simulateImageLoad('test2.jpg')

      const img = node.querySelector('img')
      node.focus()

      node.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'ArrowRight',
      }))

      expect(img?.src).toContain('test2.jpg')
    })

    test('ignores arrow keys when not focused', async () => {
      const { node } = render(<Carousel images={images} />)
      await simulateImageLoad('test1.jpg')

      const img = node.querySelector('img')
      const initialSrc = img?.src

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
      expect(img?.src).toBe(initialSrc)
    })
  })

  describe('mouse interaction', () => {
    test('opens image in new tab on middle click', () => {
      const openMock = mock(() => window)
      window.open = openMock as unknown as typeof window.open

      const { node } = render(<Carousel images={images} />)
      const img = node.querySelector('img')

      img?.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        button: 1,
      }))

      expect(openMock).toHaveBeenCalledWith('test1.jpg', '_blank')
    })

    test('handles wheel navigation', async () => {
      const { node } = render(<Carousel images={images} />)
      await simulateImageLoad('test1.jpg')
      await simulateImageLoad('test2.jpg')

      const img = node.querySelector('img')
      node.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        deltaY: 100,
      }))

      expect(img?.src).toContain('test2.jpg')
    })
  })

  describe('touch interaction', () => {
    test('handles touch swipe gestures', async () => {
      const { instance, node } = render<Carousel>(<Carousel images={images} />)
      await simulateImageLoad('test1.jpg')
      await simulateImageLoad('test2.jpg')

      const img = node.querySelector('img')

      instance.handleTouchStart({ touches: [{ clientX: 300 }] } as unknown as React.TouchEvent)
      instance.handleTouchMove({ touches: [{ clientX: 100 }] } as unknown as React.TouchEvent)
      instance.handleTouchEnd()

      expect(img?.src).toContain('test2.jpg')
    })
  })

  describe('image preloading', () => {
    test('preloads all images on mount', () => {
      const { instance } = render<Carousel>(<Carousel images={images} />)

      instance.images.forEach(img => {
        expect(
          Image.Cache.Loading.has(img.url) || Image.Cache.Resolved.has(img.url),
        ).toBe(true)
      })
    })
  })

  describe('accessibility', () => {
    test('maintains focus handling in lightbox mode', () => {
      const { node } = render(<Carousel images={images} />)
      const img = node.querySelector('img')

      img?.click()
      const lightbox = document.querySelector('.carousel.component.lightbox')
      expect(lightbox?.getAttribute('aria-modal')).toBe('true')
      expect(lightbox?.getAttribute('role')).toBe('dialog')
      expect(lightbox?.getAttribute('tabindex')).toBe('-1')
    })
  })
})
