import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { AnchorPoint } from '../../types/AnchorPoint'
import { render } from '../../testing/render'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  // Helper function to test data attributes
  const expectDataAttributes = async (tooltip: React.ReactElement, expectedAttrs: Record<string, string>) => {
    const div = await render(tooltip)
    Object.entries(expectedAttrs).forEach(([attr, value]) => {
      expect(div.node).toHaveAttribute(attr, value)
    })
  }

  describe('static properties', () => {
    test('has correct default props', () => {
      expect(Tooltip.defaultProps).toMatchObject({
        arrow: true,
        children: null,
        offset: 4,
        visible: 'auto',
      })
    })
  })

  describe('popup positioning', () => {
    test('renders with all anchor point values', async () => {
      const anchorPoints = [
        AnchorPoint.Top,
        AnchorPoint.TopStart,
        AnchorPoint.TopEnd,
        AnchorPoint.Bottom,
        AnchorPoint.BottomStart,
        AnchorPoint.BottomEnd,
        AnchorPoint.Left,
        AnchorPoint.LeftStart,
        AnchorPoint.LeftEnd,
        AnchorPoint.Right,
        AnchorPoint.RightStart,
        AnchorPoint.RightEnd,
      ]

      for (const anchorPoint of anchorPoints) {
        const div = await render(<Tooltip anchorPoint={anchorPoint}>Content</Tooltip>)
        expect(div.node).toHaveAttribute('data-popup-anchor-point', anchorPoint)
      }
    })

    test('renders with popup data attributes', async () => {
      await expectDataAttributes(
        <Tooltip arrow={true} anchorPoint={AnchorPoint.Bottom}>
          Content
        </Tooltip>,
        {
          'data-popup': 'true',
          'data-popup-anchor-point': 'bottom',
          'data-popup-arrow': 'true',
        },
      )
    })
  })

  describe('visibility handling', () => {
    test('renders with visible prop', async () => {
      await expectDataAttributes(
        <Tooltip visible={true}>Content</Tooltip>,
        { 'data-visible': 'true' },
      )

      await expectDataAttributes(
        <Tooltip visible={false}>Content</Tooltip>,
        { 'data-visible': 'false' },
      )

      await expectDataAttributes(
        <Tooltip visible="auto">Content</Tooltip>,
        { 'data-visible': 'auto' },
      )
    })
  })

  describe('combined props', () => {
    test('renders with multiple custom props', async () => {
      await expectDataAttributes(
        <Tooltip
          anchorPoint={AnchorPoint.Right}
          arrow={false}
          offset={8}
          visible={true}
        >
          Content
        </Tooltip>,
        {
          'data-popup': 'true',
          'data-popup-anchor-point': 'right',
          'data-popup-arrow': 'false',
          'data-visible': 'true',
        },
      )
    })
  })

  describe('basic rendering', () => {
    test('renders tooltip content', async () => {
      const div = await render(
        <Tooltip>
          Test tooltip content
        </Tooltip>,
      )

      expect(div.node.textContent).toContain('Test tooltip content')
    })

    test('renders with role attribute', async () => {
      const div = await render(<Tooltip>Content</Tooltip>)
      expect(div.node).toHaveAttribute('role', 'tooltip')
    })
  })
})
