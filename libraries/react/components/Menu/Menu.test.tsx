import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { Keyboard } from '../../types/Keyboard'
import { Orientation } from '../../types/Orientation'
import { Menu } from './Menu'

import './Menu.styles.ts'

describe('Menu', () => {
  test('renders conditional attributes', async () => {
    const { node, update } = await render(
      <Menu disabled>
        <Menu.Item>Item 1</Menu.Item>
      </Menu>,
    )

    expect(node).toHaveAttribute('aria-disabled', 'true')
    expect(node).toHaveAttribute('data-orientation', 'vertical')
    expect(node).toHaveAttribute('disabled')
    expect(node).toHaveAttribute('role', 'menu')

    await update(
      <Menu orientation={Orientation.Horizontal}>
        <Menu.Item>Item 1</Menu.Item>
      </Menu>,
    )

    expect(node).not.toHaveAttribute('aria-disabled')
    expect(node).not.toHaveAttribute('disabled')
    expect(node).toHaveAttribute('data-orientation', 'horizontal')
  })

  test('renders UL with LI items', async () => {
    const { node } = await render(
      <Menu>
        <Menu.Item>Item 1</Menu.Item>
        <Menu.Item>Item 2</Menu.Item>
      </Menu>,
    )

    expect(node.tagName).toBe('UL')

    const menuItems = Array.from<HTMLDivElement>(node.querySelectorAll('.menu-item.component'))
    expect(menuItems).toHaveLength(2)
    expect(menuItems.every(item => item.tagName === 'LI')).toBe(true)
    expect(menuItems.map(li => li.textContent)).toEqual(['Item 1', 'Item 2'])
  })

  test('Menu.Item supports data-* on activate', async () => {
    const onActivate = mock()
    const { node } = await render(
      <Menu.Item data-action="item-1" onActivate={onActivate}>Item 1</Menu.Item>,
    )

    await Simulate.keyDown(node, Keyboard.Enter, onActivate)

    expect(node).toHaveAttribute('data-action', 'item-1')
    expect(node).toHaveTextContent('Item 1')
    expect(onActivate).toHaveBeenLastCalledWith(expect.objectContaining({ target: node }))
  })

  test('supports Menu.Divider', async () => {
    const { node } = await render(
      <Menu>
        <Menu.Item>Item 1</Menu.Item>
        <Menu.Divider />
        <Menu.Item>Item 2</Menu.Item>
      </Menu>,
    )

    const divider = node.querySelector('.menu-divider.component')
    expect(divider).toBeTruthy()
    expect(divider?.tagName).toBe('HR')
  })
})
