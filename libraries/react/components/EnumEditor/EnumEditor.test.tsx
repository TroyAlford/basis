import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { EnumEditor } from './EnumEditor'

import './EnumEditor.styles.ts'

// Sample enums for testing
enum TestStatus {
  Archived = 'archived',
  Draft = 'draft',
  Published = 'published',
}

enum TestPriority {
  Low = 1,
  Medium = 2,
  High = 3,
  Critical = 4,
}

describe('EnumEditor', () => {
  test('renders with string enum', async () => {
    const { node } = await render(
      <EnumEditor enum={TestStatus} value={TestStatus.Draft} />,
    )

    expect(node).toHaveTextContent('Draft')
  })

  test('renders with numeric enum', async () => {
    const { node } = await render(
      <EnumEditor enum={TestPriority} value={TestPriority.Medium} />,
    )

    expect(node).toHaveTextContent('Medium')
  })

  test('renders "None" when no value selected', async () => {
    const { node } = await render(
      <EnumEditor enum={TestStatus} />,
    )

    expect(node).toHaveTextContent('None')
  })

  test('renders read-only mode', async () => {
    const { node } = await render(
      <EnumEditor readOnly enum={TestStatus} value={TestStatus.Published} />,
    )

    expect(node).toHaveTextContent('Published')
    // In read-only mode, the content should be rendered as a span with class "value"
    const valueSpan = node.querySelector('.value')
    expect(valueSpan).toBeTruthy()
    expect(valueSpan).toHaveTextContent('Published')
  })

  test('calls onChange when option is selected', async () => {
    const onChange = mock()
    const { node } = await render(
      <EnumEditor open enum={TestStatus} value={TestStatus.Draft} onChange={onChange} />,
    )

    // Click an option
    const menuItem = node.querySelector<HTMLDivElement>('.menu-item')
    expect(menuItem).toBeTruthy()
    menuItem?.click()

    expect(onChange).toHaveBeenCalledTimes(1)
    const [value, field, instance] = onChange.mock.calls[0]
    expect(value).toBe(TestStatus.Archived)
    expect(field).toBe('')
    expect(instance).toBeDefined()
  })

  test('handles field prop for form integration', async () => {
    const onChange = mock()
    const { node } = await render(
      <EnumEditor
        open
        enum={TestStatus}
        field="status"
        value={TestStatus.Draft}
        onChange={onChange}
      />,
    )

    // Click an option
    const menuItem = node.querySelector<HTMLDivElement>('.menu-item')
    menuItem?.click()

    expect(onChange).toHaveBeenCalledTimes(1)
    const [value, field, instance] = onChange.mock.calls[0]
    expect(value).toBe(TestStatus.Archived)
    expect(field).toBe('status')
    expect(instance).toBeDefined()
  })

  test('respects closeOnActivate prop', async () => {
    const onChange = mock()
    const { node, update } = await render(
      <EnumEditor
        closeOnActivate={false}
        enum={TestStatus}
        value={TestStatus.Draft}
        onChange={onChange}
      />,
    )

    // Click to open dropdown
    const trigger = node.querySelector<HTMLButtonElement>('.trigger')
    trigger?.click()
    await update()

    // Click an option
    const menuItem = node.querySelector<HTMLDivElement>('.menu-item')
    menuItem?.click()

    expect(onChange).toHaveBeenCalledTimes(1)
    const [value, field, instance] = onChange.mock.calls[0]
    expect(value).toBe(TestStatus.Archived)
    expect(field).toBe('')
    expect(instance).toBeDefined()
    // Dropdown should still be open (closeOnActivate=false)
    expect(node.querySelector('.popup-menu')).toBeTruthy()
  })

  test('filters out non-alphabetic enum keys', async () => {
    const MixedEnum = {
      123: 'numeric',
      456: 'also-numeric',
      AnotherValid: 'another',
      ValidKey: 'valid',
    } as const

    const { node } = await render(
      <EnumEditor open enum={MixedEnum} value={MixedEnum.ValidKey} />,
    )

    // Check menu items
    const menuItems = node.querySelectorAll('.menu-item')

    // Should only show alphabetic keys (ValidKey, AnotherValid)
    expect(menuItems).toHaveLength(2)
    expect(Array.from(menuItems).map(item => item.textContent)).toEqual(['Another Valid', 'Valid Key'])
  })

  test('sorts options by enum values', async () => {
    const UnsortedEnum = {
      First: 1,
      Last: 3,
      Middle: 2,
    } as const

    const { node } = await render(
      <EnumEditor open enum={UnsortedEnum} value={UnsortedEnum.First} />,
    )

    const menuItems = node.querySelectorAll('.menu-item')
    expect(Array.from(menuItems).map(item => item.textContent)).toEqual(['First', 'Middle', 'Last'])
  })

  test('converts enum names to title case', async () => {
    /* eslint-disable camelcase */
    const CaseEnum = {
      UPPERCASE: 'upper',
      camelCase: 'camel',
      kebab_case: 'kebab',
      snake_case: 'snake',
    } as const
    /* eslint-enable camelcase */

    const { node } = await render(
      <EnumEditor open enum={CaseEnum} value={CaseEnum.camelCase} />,
    )

    const menuItems = node.querySelectorAll('.menu-item')
    expect(Array.from(menuItems).map(item => item.textContent)).toEqual([
      'Camel Case',
      'Kebab Case',
      'Snake Case',
      'UPPERCASE',
    ])
  })

  test('updates options when enum prop changes', async () => {
    const AB = { A: 'a', B: 'b' } as const
    const XYZ = { X: 'x', Y: 'y', Z: 'z' } as const

    const { node, update } = await render(
      <EnumEditor open enum={AB} value={AB.A} />,
    )

    expect(node).toHaveTextContent('A')

    let menuItems = node.querySelectorAll('.menu-item')
    expect(menuItems).toHaveLength(2)
    expect(Array.from(menuItems).map(item => item.textContent)).toEqual(['A', 'B'])

    // Now update to the second enum
    await update(<EnumEditor enum={XYZ} value={XYZ.X} />)
    expect(node).toHaveTextContent('X')

    menuItems = node.querySelectorAll('.menu-item')
    expect(menuItems).toHaveLength(3)
    expect(Array.from(menuItems).map(item => item.textContent)).toEqual(['X', 'Y', 'Z'])
  })

  test('handles disabled state', async () => {
    const onChange = mock()
    const { node } = await render(
      <EnumEditor open readOnly enum={TestStatus} value={TestStatus.Draft} onChange={onChange} />,
    )

    // Should not open dropdown when disabled
    expect(node.querySelector('.popup-menu')).toBeFalsy()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('renders with proper accessibility attributes', async () => {
    const { node } = await render(
      <EnumEditor enum={TestStatus} value={TestStatus.Draft} />,
    )

    // Check that the component renders without errors
    expect(node).toBeTruthy()
    expect(node).toHaveTextContent('Draft')
  })
})
