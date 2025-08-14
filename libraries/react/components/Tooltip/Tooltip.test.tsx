import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Direction } from '../../types/Direction'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  // Helper function to test style attributes
  const expectStyleAttribute = async (
    tooltip: React.ReactElement,
    expectedProps: Record<string, string>,
  ) => {
    const div = await render(tooltip)
    expect(div.node).toHaveAttribute('style')

    const style = div.node.getAttribute('style')
    if (!style) throw new Error('Style attribute not found')
    Object.entries(expectedProps).forEach(([prop, value]) => {
      expect(style).toContain(`${prop}: ${value}`)
    })
  }

  // Helper function to test data attributes
  const expectDataAttributes = async (tooltip: React.ReactElement, expectedAttrs: Record<string, string>) => {
    const div = await render(tooltip)
    Object.entries(expectedAttrs).forEach(([attr, value]) => {
      expect(div.node).toHaveAttribute(attr, value)
    })
  }

  describe('static properties', () => {
    test('exposes Direction enum', () => {
      expect(Tooltip.Direction).toBe(Direction)
    })

    test('has correct default props', () => {
      expect(Tooltip.defaultProps).toEqual({
        animationDuration: '.125s',
        children: null,
        direction: Direction.N,
        offset: '.25em',
        visible: 'auto',
      })
    })
  })

  describe('direction positioning', () => {
    test('renders with all direction values', async () => {
      const directions = [
        Direction.N,
        Direction.NE,
        Direction.E,
        Direction.SE,
        Direction.S,
        Direction.SW,
        Direction.W,
        Direction.NW,
      ]

      for (const direction of directions) {
        const div = await render(<Tooltip direction={direction}>Content</Tooltip>)
        expect(div.node).toHaveAttribute('data-direction', direction)
      }
    })
  })

  describe('animation duration handling', () => {
    test('handles string values', async () => {
      await expectStyleAttribute(
        <Tooltip animationDuration=".3s">Content</Tooltip>,
        { '--tooltip-animation-duration': '.3s' },
      )
    })

    test('handles numeric values (appends s)', async () => {
      await expectStyleAttribute(
        <Tooltip animationDuration={0.2}>Content</Tooltip>,
        { '--tooltip-animation-duration': '0.2s' },
      )
    })

    test('handles zero and negative values', async () => {
      await expectStyleAttribute(
        <Tooltip animationDuration={0}>Content</Tooltip>,
        { '--tooltip-animation-duration': '0s' },
      )

      await expectStyleAttribute(
        <Tooltip animationDuration={-0.1}>Content</Tooltip>,
        { '--tooltip-animation-duration': '-0.1s' },
      )
    })

    test('falls back to default for nil/empty values', async () => {
      await expectStyleAttribute(
        <Tooltip animationDuration="">Content</Tooltip>,
        { '--tooltip-animation-duration': '.125s' },
      )

      await expectStyleAttribute(
        <Tooltip animationDuration={null}>Content</Tooltip>,
        { '--tooltip-animation-duration': '.125s' },
      )
    })
  })

  describe('offset handling', () => {
    test('handles string values', async () => {
      await expectStyleAttribute(
        <Tooltip offset="1rem">Content</Tooltip>,
        { '--tooltip-offset': '1rem' },
      )
    })

    test('handles numeric values (appends px)', async () => {
      await expectStyleAttribute(
        <Tooltip offset={16}>Content</Tooltip>,
        { '--tooltip-offset': '16px' },
      )
    })

    test('handles zero and negative values', async () => {
      await expectStyleAttribute(
        <Tooltip offset={0}>Content</Tooltip>,
        { '--tooltip-offset': '0px' },
      )

      await expectStyleAttribute(
        <Tooltip offset={-10}>Content</Tooltip>,
        { '--tooltip-offset': '-10px' },
      )
    })

    test('falls back to default for nil/empty values', async () => {
      await expectStyleAttribute(
        <Tooltip offset="">Content</Tooltip>,
        { '--tooltip-offset': '.25em' },
      )

      await expectStyleAttribute(
        <Tooltip offset={null}>Content</Tooltip>,
        { '--tooltip-offset': '.25em' },
      )
    })
  })

  describe('combined props', () => {
    test('renders with multiple custom props', async () => {
      await expectDataAttributes(
        <Tooltip
          animationDuration={0.5}
          direction={Direction.E}
          offset={32}
          visible={true}
        >
          Content
        </Tooltip>,
        {
          'data-direction': 'E',
          'data-visible': 'true',
          'role': 'tooltip',
        },
      )

      await expectStyleAttribute(
        <Tooltip
          animationDuration={0.5}
          direction={Direction.E}
          offset={32}
          visible={true}
        >
          Content
        </Tooltip>,
        {
          '--tooltip-animation-duration': '0.5s',
          '--tooltip-offset': '32px',
        },
      )
    })
  })
})
