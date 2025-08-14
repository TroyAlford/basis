import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Direction } from '../../types/Direction'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  describe('rendering', () => {
    test('renders with default props', async () => {
      const div = await render(<Tooltip>Tooltip content</Tooltip>)

      expect(div.node.tagName).toBe('DIV')
      expect(div.node).toHaveClass('tooltip', 'component')
      expect(div.node).toHaveAttribute('data-direction', 'N')
      expect(div.node).toHaveAttribute('data-visible', 'auto')
      expect(div.node).toHaveAttribute('role', 'tooltip')
    })

    test('renders with custom direction', async () => {
      const div = await render(
        <Tooltip direction={Direction.SE}>Bottom right tooltip</Tooltip>,
      )

      expect(div.node).toHaveAttribute('data-direction', 'SE')
    })

    test('renders with custom visible state', async () => {
      const div = await render(
        <Tooltip visible={true}>Visible tooltip</Tooltip>,
      )

      expect(div.node).toHaveAttribute('data-visible', 'true')
    })

    test('renders with custom animation duration', async () => {
      const div = await render(
        <Tooltip animationDuration=".3s">Animated tooltip</Tooltip>,
      )

      expect(div.node).toHaveAttribute('style')
      const style = div.node.getAttribute('style')
      expect(style).toContain('--tooltip-animation-duration: .3s')
    })

    test('renders with string offset', async () => {
      const div = await render(
        <Tooltip offset="1rem">Offset tooltip</Tooltip>,
      )

      expect(div.node).toHaveAttribute('style')
      const style = div.node.getAttribute('style')
      expect(style).toContain('--tooltip-offset: 1rem')
    })

    test('renders with numeric offset (auto-appends px)', async () => {
      const div = await render(
        <Tooltip offset={8}>Numeric offset tooltip</Tooltip>,
      )

      expect(div.node).toHaveAttribute('style')
      const style = div.node.getAttribute('style')
      expect(style).toContain('--tooltip-offset: 8px')
    })

    test('renders with zero offset', async () => {
      const div = await render(
        <Tooltip offset={0}>Zero offset tooltip</Tooltip>,
      )

      expect(div.node).toHaveAttribute('style')
      const style = div.node.getAttribute('style')
      expect(style).toContain('--tooltip-offset: 0px')
    })
  })

  describe('content structure', () => {
    test('renders bubble and arrow elements', async () => {
      const div = await render(<Tooltip>Content</Tooltip>)

      const bubble = div.node.querySelector('.bubble')
      const arrow = div.node.querySelector('.arrow')

      expect(bubble).toBeTruthy()
      expect(arrow).toBeTruthy()
      expect(bubble?.textContent).toBe('Content')
    })

    test('renders as div element', async () => {
      const div = await render(<Tooltip>Content</Tooltip>)

      expect(div.node.tagName).toBe('DIV')
    })
  })

  describe('class names', () => {
    test('includes tooltip class', async () => {
      const div = await render(<Tooltip>Content</Tooltip>)

      expect(div.node).toHaveClass('tooltip')
      expect(div.node).toHaveClass('component')
    })
  })

  describe('offset handling', () => {
    test('handles undefined offset with fallback', async () => {
      const div = await render(
        <Tooltip offset={undefined}>Content</Tooltip>,
      )

      expect(div.node).toHaveAttribute('style')
      const style = div.node.getAttribute('style')
      expect(style).toContain('--tooltip-offset: .25em')
    })

    test('handles null offset with fallback', async () => {
      const div = await render(
        <Tooltip offset={null}>Content</Tooltip>,
      )

      expect(div.node).toHaveAttribute('style')
      const style = div.node.getAttribute('style')
      expect(style).toContain('--tooltip-offset: .25em')
    })

    test('handles decimal numeric offset', async () => {
      const div = await render(
        <Tooltip offset={0.5}>Content</Tooltip>,
      )

      expect(div.node).toHaveAttribute('style')
      const style = div.node.getAttribute('style')
      expect(style).toContain('--tooltip-offset: 0.5px')
    })

    test('handles negative numeric offset', async () => {
      const div = await render(
        <Tooltip offset={-10}>Content</Tooltip>,
      )

      expect(div.node).toHaveAttribute('style')
      const style = div.node.getAttribute('style')
      expect(style).toContain('--tooltip-offset: -10px')
    })
  })

  describe('style attributes', () => {
    test('includes all CSS custom properties', async () => {
      const div = await render(
        <Tooltip
          animationDuration=".5s"
          offset="2rem"
        >
          Content
        </Tooltip>,
      )

      expect(div.node).toHaveAttribute('style')
      const style = div.node.getAttribute('style')
      expect(style).toContain('--tooltip-animation-duration: .5s')
      expect(style).toContain('--tooltip-offset: 2rem')
    })

    test('handles empty string animation duration', async () => {
      const div = await render(
        <Tooltip animationDuration="">Content</Tooltip>,
      )

      expect(div.node).toHaveAttribute('style')
      const style = div.node.getAttribute('style')
      // Empty string animation duration should not output the property (reasonable behavior)
      expect(style).not.toContain('--tooltip-animation-duration')
    })
  })
})
