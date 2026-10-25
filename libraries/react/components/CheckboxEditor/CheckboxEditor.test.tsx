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

describe('CheckboxEditor', () => {
  test('renders a labelled native checkbox', async () => {
    const { node } = await render(
      <CheckboxEditor label="Select row" value={false} onChange={() => undefined} />,
    )

    expect(input(node).type).toBe('checkbox')
    expect(input(node).checked).toBe(false)
    expect(input(node)).toHaveAttribute('aria-label', 'Select row')
  })

  test('disables the native checkbox when disabled', async () => {
    const { node } = await render(
      <CheckboxEditor disabled label="Select row" value={true} onChange={() => undefined} />,
    )

    expect(input(node).disabled).toBe(true)
    expect(input(node).checked).toBe(true)
  })

  test('disables the native checkbox when read-only', async () => {
    const { node } = await render(
      <CheckboxEditor readOnly label="Select row" value={true} onChange={() => undefined} />,
    )

    expect(input(node).disabled).toBe(true)
  })

  test('exposes the indeterminate state', async () => {
    const { node } = await render(
      <CheckboxEditor label="Select page" value={null} onChange={() => undefined} />,
    )

    expect(input(node).checked).toBe(false)
    expect(input(node).indeterminate).toBe(true)
    expect(input(node)).toHaveAttribute('aria-checked', 'mixed')
  })
})
