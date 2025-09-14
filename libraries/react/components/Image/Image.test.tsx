import { describe, expect, mock, spyOn, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import * as loadImageModule from '../../utilities/loadImage'
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
      expect(node).toHaveAttribute('data-align', Image.Align.NorthWest)
      expect(node).toHaveAttribute('data-size', Image.Size.Contain)
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

  describe('image loading', () => {
    test('sets loading state initially', async () => {
      const { node } = await render(
        <Image src="/test-image.jpg" />,
      )

      expect(node).toHaveAttribute('data-loading', 'true')
      expect(node).toHaveAttribute('data-error', 'false')
    })

    test('handles image loading error', async () => {
      const loadImageSpy = spyOn(loadImageModule, 'loadImage').mockResolvedValue(null)

      const { node } = await render(
        <Image src="/invalid-image.jpg" />,
      )

      // Wait for loading to complete
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(node).toHaveAttribute('data-loading', 'false')
      expect(node).toHaveAttribute('data-error', 'true')

      loadImageSpy.mockRestore()
    })
  })

  describe('sizing modes', () => {
    test('applies correct styles for natural size', async () => {
      const { node } = await render(
        <Image size={Image.Size.Natural} src="/sized-image.jpg" />,
      )
      expect(node).toHaveAttribute('data-size', Image.Size.Natural)
    })

    test('applies correct styles for contain size', async () => {
      const { node } = await render(
        <Image size={Image.Size.Contain} src="/contain-image.jpg" />,
      )

      expect(node).toHaveAttribute('data-size', Image.Size.Contain)
    })

    test('applies correct styles for cover size', async () => {
      const { node } = await render(
        <Image size={Image.Size.Cover} src="/cover-image.jpg" />,
      )

      expect(node).toHaveAttribute('data-size', Image.Size.Cover)
    })
  })

  describe('alignment modes', () => {
    test('applies correct alignment attributes', async () => {
      const { node } = await render(
        <Image align={Image.Align.NorthEast} src="/aligned-image.jpg" />,
      )

      expect(node).toHaveAttribute('data-align', Image.Align.NorthEast)
    })

    test('applies center alignment by default', async () => {
      const { node } = await render(<Image src="/default-image.jpg" />)
      expect(node).toHaveAttribute('data-align', Image.Align.Center)
    })
  })
})
