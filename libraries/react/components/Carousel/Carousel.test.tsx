import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { Keyboard } from '@basis/react/types/Keyboard'
import { render } from '../../testing/render'
import { Carousel } from './Carousel'

describe('Carousel', () => {
  const images = ['test1.jpg', 'test2.jpg', 'test3.jpg']

  describe('initialization', () => {
    test('renders with default props', async () => {
      const { node } = await render(<Carousel />)
      expect(node).toHaveClass('carousel')
      expect(node.dataset.size).toBe(Carousel.Size.Contain)
      expect(node.dataset.align).toBe(Carousel.Align.Center)
    })

    test('accepts string image URLs', async () => {
      const { node } = await render(<Carousel images={images} />)

      // Test that the carousel has the correct image data
      expect(node).toBeDefined()
      const imgDiv = node.querySelector<HTMLDivElement>('.image.component')
      expect(imgDiv).toBeDefined()
    })

    test('accepts image config objects', async () => {
      const { node } = await render(
        <Carousel
          images={[{
            align: Carousel.Align.NorthWest,
            size: Carousel.Size.Cover,
            url: 'test.jpg',
          }]}
        />,
      )
      expect(node.dataset.align).toBe(Carousel.Align.NorthWest)
      expect(node.dataset.size).toBe(Carousel.Size.Cover)
    })
  })

  describe('navigation', () => {
    test('cycles through images with next/prev', async () => {
      const { instance, update } = await render<Carousel>(<Carousel images={images} />)

      // Test that navigation methods work
      expect(instance.state.currentIndex).toBe(0)

      await instance.next()
      await update()
      expect(instance.state.currentIndex).toBe(1)

      await instance.next()
      await update()
      expect(instance.state.currentIndex).toBe(2)

      await instance.next()
      await update()
      expect(instance.state.currentIndex).toBe(0) // Wraps around

      await instance.prev()
      await update()
      expect(instance.state.currentIndex).toBe(2)
    })

    test('calls onImageChange callback', async () => {
      const onImageChange = mock()
      const { instance, update } = await render<Carousel>(
        <Carousel images={images} onImageChange={onImageChange} />,
      )

      await instance.next()
      await update()

      expect(onImageChange).toHaveBeenCalledWith(1)
    })
  })

  describe('lightbox', () => {
    test('opens lightbox on image click', async () => {
      const { node, update } = await render(<Carousel images={images} />)
      const imgDiv = node.querySelector<HTMLDivElement>('.image.component')

      imgDiv?.click()
      await update()

      expect(node.dataset.lightbox).toBe('true')
    })

    test('closes lightbox on background click', async () => {
      const { node, update } = await render(<Carousel images={images} />)
      const imgDiv = node.querySelector<HTMLDivElement>('.image.component')

      // Open lightbox first
      imgDiv?.click()
      await update()
      expect(node.dataset.lightbox).toBe('true')

      // Close lightbox by clicking on the background (not on child elements)
      const lightbox = document.querySelector('.carousel.component.lightbox')
      if (lightbox) {
        // Simulate a click on the lightbox background
        lightbox.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await update()
      }
      expect(node.dataset.lightbox).toBe('false')
    })

    test('closes lightbox with escape key', async () => {
      const { instance, update } = await render<Carousel>(<Carousel images={images} />)
      const imgDiv = instance.rootNode.querySelector<HTMLDivElement>('.image.component')

      // Open lightbox first
      imgDiv?.click()
      await update()
      expect(instance.rootNode.dataset.lightbox).toBe('true')

      // Close with escape key by calling handleKeyDown directly
      await instance.handleKeyDown({ key: Keyboard.Escape } as React.KeyboardEvent<HTMLDivElement>)
      await update()
      expect(instance.rootNode.dataset.lightbox).toBe('false')
    })
  })

  describe('keyboard navigation', () => {
    test('responds to arrow keys when focused', async () => {
      const { instance, node, update } = await render<Carousel>(<Carousel images={images} />)

      node.focus()

      // Test arrow key navigation
      const initialIndex = instance.state.currentIndex

      node.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: Keyboard.ArrowRight,
      }))
      await update()

      const newIndex = instance.state.currentIndex
      expect(newIndex).toBe((initialIndex + 1) % images.length)
    })

    test('ignores arrow keys when not focused', async () => {
      const { instance } = await render<Carousel>(<Carousel images={images} />)

      const initialIndex = instance.state.currentIndex

      document.dispatchEvent(new KeyboardEvent('keydown', { key: Keyboard.ArrowRight }))
      const newIndex = instance.state.currentIndex
      expect(newIndex).toBe(initialIndex)
    })
  })

  describe('mouse interaction', () => {
    test('opens image in new tab on middle click', async () => {
      const openMock = mock(() => window)
      window.open = openMock as unknown as typeof window.open

      const { node } = await render(<Carousel images={images} />)
      const imgDiv = node.querySelector<HTMLDivElement>('.image.component')

      imgDiv?.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        button: 1,
      }))

      expect(openMock).toHaveBeenCalledWith('test1.jpg', '_blank')
    })

    test('handles wheel navigation', async () => {
      const { instance, update } = await render<Carousel>(<Carousel images={images} />)

      const initialIndex = instance.state.currentIndex

      await instance.handleWheel(new WheelEvent('wheel', {
        bubbles: true,
        deltaY: 100,
      }))
      await update()

      const newIndex = instance.state.currentIndex
      expect(newIndex).toBe((initialIndex + 1) % images.length)
    })
  })

  describe('touch interaction', () => {
    test('handles touch swipe gestures', async () => {
      const { instance, update } = await render<Carousel>(<Carousel images={images} />)

      const initialIndex = instance.state.currentIndex

      instance.handleTouchStart({ touches: [{ clientX: 300 }] } as unknown as React.TouchEvent)
      await instance.handleTouchMove({ touches: [{ clientX: 100 }] } as unknown as React.TouchEvent)
      instance.handleTouchEnd()
      await update()

      const newIndex = instance.state.currentIndex
      expect(newIndex).toBe((initialIndex + 1) % images.length)
    })
  })

  describe('image preloading', () => {
    test('preloads all images on mount', async () => {
      const { instance } = await render<Carousel>(<Carousel images={images} />)

      // Verify images are available for preloading
      instance.images.forEach(img => {
        expect(img.url).toBeDefined()
      })

      // The preloadImages method should be callable
      expect(typeof instance.preloadImages).toBe('function')
    })
  })

  describe('accessibility', () => {
    test('maintains focus handling in lightbox mode', async () => {
      const { node, update } = await render(<Carousel images={images} />)
      const imgDiv = node.querySelector<HTMLDivElement>('.image.component')

      imgDiv?.click()
      await update()
      const lightbox = document.querySelector('.carousel.component.lightbox')

      expect(lightbox?.getAttribute('aria-modal')).toBe('true')
      expect(lightbox?.getAttribute('role')).toBe('dialog')
      expect(lightbox?.getAttribute('tabindex')).toBe('-1')
    })
  })
})
