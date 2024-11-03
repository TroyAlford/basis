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
    test('responds to arrow keys in lightbox mode', async () => {
      const { node } = render(<Carousel images={images} />)

      // Pre-load images
      await simulateImageLoad('test1.jpg')
      await simulateImageLoad('test2.jpg')

      const img = node.querySelector('img')
      img?.click() // Open lightbox

      const rightArrowEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'ArrowRight',
      })
      node.dispatchEvent(rightArrowEvent)

      expect(img?.src).toContain('test2.jpg')
    })
  })

  describe('touch navigation', () => {
    test('handles touch swipe gestures', async () => {
      const { instance, node } = render<Carousel>(<Carousel images={images} />)

      // Pre-load images
      await simulateImageLoad('test1.jpg')
      await simulateImageLoad('test2.jpg')

      const img = node.querySelector('img')

      instance.handleTouchStart({ touches: [{ clientX: 300 }] } as unknown as React.TouchEvent)
      instance.handleTouchMove({ touches: [{ clientX: 100 }] } as unknown as React.TouchEvent)
      instance.handleTouchEnd()

      expect(img?.src).toContain('test2.jpg')
    })
  })

  describe('wheel navigation', () => {
    test('responds to wheel events', async () => {
      const { node } = render(<Carousel images={images} />)

      // Pre-load images
      await simulateImageLoad('test1.jpg')
      await simulateImageLoad('test2.jpg')

      const img = node.querySelector('img')
      img?.click() // Open lightbox

      const wheelEvent = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: 100,
      })
      node.dispatchEvent(wheelEvent)

      expect(img?.src).toContain('test2.jpg')
    })
  })

  describe('edge cases', () => {
    test('handles empty image array', () => {
      const { node } = render(<Carousel images={[]} />)
      expect(node.querySelector('img')).toBeFalsy()
    })

    test('handles children as image URLs', () => {
      simulateImageLoad('test1.jpg')
      simulateImageLoad('test2.jpg')
      const { node } = render(
        <Carousel>
          <img src="test1.jpg" />
          <img src="test2.jpg" />
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

  describe('image configuration', () => {
    test('correctly parses data-align attribute values', () => {
      const { node } = render(
        <Carousel>
          <img data-align="NorthWest" src="test1.jpg" />
        </Carousel>,
      )
      expect(node.dataset.align).toBe('nw')
    })

    test('falls back to default align when no valid align is provided', () => {
      const { node } = render(
        <Carousel>
          <img data-align="invalid" src="test1.jpg" />
        </Carousel>,
      )
      expect(node.dataset.align).toBe('center')
    })

    test('handles alt text from both props and children', () => {
      const { node: propsNode } = render(
        <Carousel
          images={[
            { altText: 'Test 1', url: 'test1.jpg' },
            'test2.jpg',
          ]}
        />,
      )
      expect(propsNode.querySelector('img')?.alt).toBe('Test 1')

      const { node: childrenNode } = render(
        <Carousel>
          <img alt="Child Test 1" src="test1.jpg" />
        </Carousel>,
      )
      expect(childrenNode.querySelector('img')?.alt).toBe('Child Test 1')
    })

    test('correctly parses data-size attribute values', () => {
      const { node } = render(
        <Carousel>
          <img data-size="Contain" src="test1.jpg" />
          <img data-size="contain" src="test2.jpg" />
          <img data-size="invalid" src="test3.jpg" />
        </Carousel>,
      )
      expect(node.dataset.size).toBe('contain')
    })

    test('combines images from both props and children', () => {
      const { instance } = render<Carousel>(
        <Carousel images={['prop1.jpg', 'prop2.jpg']}>
          <img src="child1.jpg" />
          <img src="child2.jpg" />
        </Carousel>,
      )

      expect(instance.images.length).toBe(4)

      expect(instance.currentImage?.url).toBe('prop1.jpg')
      instance.next()
      expect(instance.currentImage?.url).toBe('prop2.jpg')
      instance.next()
      expect(instance.currentImage?.url).toBe('child1.jpg')
      instance.next()
      expect(instance.currentImage?.url).toBe('child2.jpg')
    })

    test('filters out non-img children', () => {
      const { instance } = render<Carousel>(
        <Carousel>
          <img src="test1.jpg" />
          <div>Not an image</div>
          <img src="test2.jpg" />
        </Carousel>,
      )

      expect(instance.images.length).toBe(2)
    })
  })

  describe('children handling', () => {
    test('accepts both img and Image components as children', () => {
      const { instance } = render<Carousel>(
        <Carousel>
          <img alt="Test 1" src="test1.jpg" />
          <Image alt="Test 2" src="test2.jpg" />
        </Carousel>,
      )

      expect(instance.images.length).toBe(2)
      expect(instance.images[0].url).toBe('test1.jpg')
      expect(instance.images[1].url).toBe('test2.jpg')
    })

    test('respects alt text hierarchy', () => {
      const { instance, node } = render<Carousel>(
        <Carousel altText="Default alt">
          <img alt="Image alt" src="test1.jpg" />
          <img src="test2.jpg" />
        </Carousel>,
      )

      // Load both images but only first one should be visible
      simulateImageLoad('test1.jpg')
      simulateImageLoad('test2.jpg')

      // Check first image
      const firstImg = node.querySelector('img')
      expect(firstImg?.alt).toBe('Image alt')

      // Navigate to second image
      instance.next()
      const secondImg = node.querySelector('img')
      expect(secondImg?.alt).toBe('Default alt')
    })

    test('preserves Image component props', () => {
      const { instance } = render<Carousel>(
        <Carousel>
          <Image
            align={Image.Align.NorthWest}
            alt="Test"
            size={Image.Size.Fill}
            src="test.jpg"
          />
        </Carousel>,
      )

      const image = instance.images[0]
      expect(image.align).toBe(Image.Align.NorthWest)
      expect(image.size).toBe(Image.Size.Fill)
    })
  })

  describe('image preloading', () => {
    test('preloads all carousel images on mount', () => {
      const { instance } = render<Carousel>(
        <Carousel images={['test1.jpg', 'test2.jpg', 'test3.jpg']} />,
      )

      // Should have started loading all images
      instance.images.forEach(img => {
        expect(
          Image.Cache.Loading.has(img.url) || Image.Cache.Resolved.has(img.url),
        ).toBe(true)
      })
    })

    test('handles duplicate image URLs', () => {
      render<Carousel>(
        <Carousel images={['test1.jpg', 'test1.jpg', 'test2.jpg']} />,
      )

      // Should only create one loading promise per unique URL
      expect(Image.Cache.Loading.size).toBe(2)
    })
  })
})
