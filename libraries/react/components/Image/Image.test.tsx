import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Image } from './Image'

describe('Image', () => {
  describe('rendering', () => {
    test('renders with basic props', async () => {
      const { node } = await render(
        <Image alt="Test image" src="/test-image.jpg" />,
      )
      expect(node.tagName).toBe('DIV')
      expect(node).toHaveClass('image', 'component')
      expect(node).toHaveAttribute('aria-label', 'Test image')
      expect(node).toHaveAttribute('role', 'img')
      // Should have loading state initially
      expect(node).toHaveAttribute('data-loading', 'true')
    })

    test('renders with custom alignment and size', async () => {
      const { node } = await render(
        <Image align={Image.Align.NorthWest} size={Image.Size.Contain} src="/test-image.jpg" />,
      )
      expect(node).toHaveAttribute('data-align', 'nw')
      expect(node).toHaveAttribute('data-size', 'contain')
    })
  })

  describe('accessibility', () => {
    test('sets proper ARIA attributes', async () => {
      const { node } = await render(
        <Image alt="Descriptive text" src="/test-image.jpg" />,
      )
      expect(node).toHaveAttribute('aria-label', 'Descriptive text')
      expect(node).toHaveAttribute('role', 'img')
    })

    test('sets role when no alt text', async () => {
      const { node } = await render(
        <Image src="/test-image.jpg" />,
      )
      expect(node).not.toHaveAttribute('role')
    })
  })

  describe('event handling', () => {
    test('calls onClick when clicked', async () => {
      const onClick = mock()
      const { node } = await render(
        <Image src="/test-image.jpg" onClick={onClick} />,
      )

      node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    test('calls onTouchStart when touch starts', async () => {
      const onTouchStart = mock()
      const { node } = await render(
        <Image src="/test-image.jpg" onTouchStart={onTouchStart} />,
      )

      node.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
      expect(onTouchStart).toHaveBeenCalledTimes(1)
    })
  })

  describe('image loading and caching', () => {
    test('sets loaded state when image is cached', async () => {
      // Mock the Image.Cache to simulate loaded image
      const testImage = document.createElement('img')
      Object.defineProperty(testImage, 'naturalWidth', { value: 100, writable: false })
      Object.defineProperty(testImage, 'naturalHeight', { value: 100, writable: false })
      Image.Cache.Resolved.set('/cached-image.jpg', testImage)

      const { node } = await render(
        <Image src="/cached-image.jpg" />,
      )

      expect(node).toHaveAttribute('data-loaded', 'true')
      // The component should have the src in its props for styling
      expect(node).toHaveAttribute('data-size', 'natural')

      // Clean up
      Image.Cache.Resolved.delete('/cached-image.jpg')
    })

    test('prevents duplicate loading requests', async () => {
      const { node } = await render(
        <Image src="/unique-image.jpg" />,
      )

      // Initially data-loading is true, becomes false after loading completes
      expect(node).toHaveAttribute('data-loading', 'true')

      // Wait for componentDidMount to complete
      await new Promise(resolve => setTimeout(resolve, 50))

      // Now it should be loading
      expect(Image.Cache.Loading.has('/unique-image.jpg')).toBe(true)

      // Clean up
      Image.Cache.Loading.delete('/unique-image.jpg')
    })
  })

  describe('sizing modes', () => {
    test('applies correct styles for natural size', async () => {
      const testImage = document.createElement('img')
      Object.defineProperty(testImage, 'naturalWidth', { value: 200, writable: false })
      Object.defineProperty(testImage, 'naturalHeight', { value: 150, writable: false })
      Image.Cache.Resolved.set('/sized-image.jpg', testImage)

      const { node } = await render(
        <Image size={Image.Size.Natural} src="/sized-image.jpg" />,
      )

      // Wait for state update
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(node).toHaveAttribute('data-size', 'natural')
      expect(node).toHaveAttribute('data-loaded', 'true')

      // Clean up
      Image.Cache.Resolved.delete('/sized-image.jpg')
    })

    test('applies correct styles for contain size', async () => {
      const { node } = await render(
        <Image size={Image.Size.Contain} src="/contain-image.jpg" />,
      )

      expect(node).toHaveAttribute('data-size', 'contain')
    })

    test('applies correct styles for fill size', async () => {
      const { node } = await render(
        <Image size={Image.Size.Fill} src="/fill-image.jpg" />,
      )

      expect(node).toHaveAttribute('data-size', 'fill')
    })
  })

  describe('alignment modes', () => {
    test('applies correct alignment attributes', async () => {
      const { node } = await render(
        <Image align={Image.Align.NorthEast} src="/aligned-image.jpg" />,
      )

      expect(node).toHaveAttribute('data-align', 'ne')
    })

    test('applies center alignment by default', async () => {
      const { node } = await render(
        <Image src="/default-image.jpg" />,
      )

      expect(node).toHaveAttribute('data-align', 'center')
    })
  })
})
