import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { CheckboxEditor } from './CheckboxEditor'

/**
 * The editor's native checkbox.
 * @param node - The rendered editor.
 * @returns The checkbox input.
 */
const input = (node: HTMLElement): HTMLInputElement => node.querySelector('input') as HTMLInputElement

/**
 * The editor's displayed glyph.
 * @param node - The rendered editor.
 * @returns The glyph SVG.
 */
const glyph = (node: HTMLElement): SVGElement => node.querySelector('svg') as SVGElement

describe('CheckboxEditor', () => {
  test('renders an empty square for false', async () => {
    const { node } = await render(
      <CheckboxEditor label="Select row" value={false} onChange={() => undefined} />,
    )

    expect(glyph(node)).toHaveClass('square', 'component', 'icon')
    expect(input(node).checked).toBe(false)
    expect(input(node)).toHaveAttribute('aria-label', 'Select row')
  })

  test('renders a check for true', async () => {
    const { node } = await render(
      <CheckboxEditor label="Select row" value={true} onChange={() => undefined} />,
    )

    expect(glyph(node)).toHaveClass('square-check-icon', 'component', 'icon')
    expect(input(node).checked).toBe(true)
  })

  test('renders a dash for null', async () => {
    const { node } = await render(
      <CheckboxEditor label="Select all rows" value={null} onChange={() => undefined} />,
    )

    expect(glyph(node)).toHaveClass('square-dash-icon', 'component', 'icon')
    expect(input(node).checked).toBe(false)
    expect(input(node).indeterminate).toBe(true)
    expect(input(node)).toHaveAttribute('aria-checked', 'mixed')
  })

  test('keeps each glyph while disabled', async () => {
    for (const [value, className] of [
      [false, 'square'],
      [true, 'square-check-icon'],
      [null, 'square-dash-icon'],
    ] as const) {
      const { node } = await render(
        <CheckboxEditor disabled label="Select row" value={value} onChange={() => undefined} />,
      )

      expect(glyph(node)).toHaveClass(className)
      expect(node).toHaveAttribute('disabled')
      expect(input(node).disabled).toBe(true)
    }
  })

  test('keeps each glyph while read-only', async () => {
    const { node } = await render(
      <CheckboxEditor readOnly label="Select row" value={true} onChange={() => undefined} />,
    )

    expect(glyph(node)).toHaveClass('square-check-icon')
    expect(node).toHaveAttribute('readonly')
    expect(input(node).disabled).toBe(true)
  })
})
