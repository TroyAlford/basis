import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Carousel } from './Carousel'

describe('Carousel', () => {
  const images = ['test1.jpg', 'test2.jpg', 'test3.jpg']

  describe('initialization', () => {
    test('renders with default props', () => {
      const { node } = render(<Carousel />)
      expect(node).toHaveClass('carousel')
      expect(node.dataset.size).toBe(Carousel.Size.Contain)
      expect(node.dataset.align).toBe(Carousel.Align.Center)
    })

    test('accepts string image URLs', () => {
      const { node } = render(<Carousel images={images} />)
      const img = node.querySelector('img')
      expect(img?.src).toContain('test1.jpg')
    })

    test('accepts image config objects', () => {
      const { node } = render(
        <Carousel
          images={[{
            align: Carousel.Align.NorthWest,
            size: Carousel.Size.Fill,
            url: 'test.jpg',
          }]}
        />,
      )
      expect(node.dataset.align).toBe('nw')
      expect(node.dataset.size).toBe('fill')
    })
  })

  describe('navigation', () => {
    test('cycles through images with next/prev', () => {
      const { instance, node } = render<Carousel>(<Carousel images={images} />)
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

    test('calls onImageChange callback', () => {
      const onImageChange = mock()
      const { instance } = render<Carousel>(
        <Carousel images={images} onImageChange={onImageChange} />,
      )

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
      expect(node.querySelector('.lightbox-overlay')).toBeTruthy()
    })

    test('closes lightbox on background click', () => {
      const { node } = render(<Carousel images={images} />)
      const img = node.querySelector('img')

      img?.click()
      const overlay = node.querySelector<HTMLDivElement>('.lightbox-overlay')
      overlay?.click()
      expect(node.dataset.lightbox).toBe('false')
    })

    test('toggles full-size mode in lightbox', () => {
      const { node } = render(<Carousel images={images} />)
      const img = node.querySelector('img')

      img?.click()
      const lightboxImg = node.querySelector<HTMLImageElement>('.lightbox-overlay img')
      lightboxImg?.click()
      expect(node.dataset.fullSize).toBe('true')

      lightboxImg?.click()
      expect(node.dataset.fullSize).toBe('false')
    })
  })

  describe('keyboard navigation', () => {
    test('responds to arrow keys in lightbox mode', () => {
      const { node } = render(<Carousel images={images} />)
      const img = node.querySelector('img')

      img?.click()

      const rightArrowEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'ArrowRight',
      })
      node.dispatchEvent(rightArrowEvent)
      node.dispatchEvent(new Event('input', { bubbles: true }))

      expect(img?.src).toContain('test2.jpg')
    })
  })

  describe('touch navigation', () => {
    test('handles touch swipe gestures', () => {
      const { instance, node } = render<Carousel>(<Carousel images={images} />)
      const img = node.querySelector('img')

      /* eslint-disable dot-notation */
      // Simulate touch sequence directly through component methods
      instance['handleTouchStart']({ touches: [{ clientX: 300 }] } as unknown as React.TouchEvent)
      instance['handleTouchMove']({ touches: [{ clientX: 100 }] } as unknown as React.TouchEvent)
      instance['handleTouchEnd']()
      /* eslint-enable dot-notation */

      expect(img?.src).toContain('test2.jpg')
    })
  })

  describe('wheel navigation', () => {
    test('responds to wheel events', () => {
      const { node } = render(<Carousel images={images} />)
      const img = node.querySelector('img')

      const wheelEvent = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: 100,
      })
      node.dispatchEvent(wheelEvent)

      // Force a re-render
      node.dispatchEvent(new Event('input', { bubbles: true }))

      expect(img?.src).toContain('test2.jpg')
    })
  })

  describe('edge cases', () => {
    test('handles empty image array', () => {
      const { node } = render(<Carousel images={[]} />)
      expect(node.querySelector('img')).toBeFalsy()
    })

    test('handles children as image URLs', () => {
      const { node } = render(
        <Carousel>
          test1.jpg
          test2.jpg
        </Carousel>,
      )
      const img = node.querySelector('img')
      expect(img?.src).toContain('test1.jpg')
    })

    test('keyboard navigation does nothing when lightbox closed', () => {
      const { node } = render(<Carousel images={images} />)
      const img = node.querySelector('img')
      const initialSrc = img?.src

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
      expect(img?.src).toBe(initialSrc)
    })
  })
})
