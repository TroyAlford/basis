import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { DropdownMenu } from './DropdownMenu'

describe('DropdownMenu', () => {
  test('renders trigger when provided', async () => {
    const { node } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    expect(node.textContent).toContain('Open Menu')
  })

  test('renders dropdown when open', async () => {
    const { node, update } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
        <DropdownMenu.Item>Item 2</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector<HTMLButtonElement>('.trigger')
    trigger?.click()
    await update()

    expect(node.textContent).toContain('Item 1')
    expect(node.textContent).toContain('Item 2')
  })

  test('renders only trigger when readOnly', async () => {
    const { node } = await render(
      <DropdownMenu trigger="Read Only">
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    expect(node.textContent).toContain('Read Only')
    expect(node.textContent).not.toContain('Item 1')
  })

  test('supports DropdownMenu.Divider', async () => {
    const { node, update } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
        <DropdownMenu.Divider />
        <DropdownMenu.Item>Item 2</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector<HTMLButtonElement>('.trigger')
    trigger?.click()
    await update()

    expect(node.querySelector('hr')).toBeTruthy()
  })

  test('closes when clicking outside', async () => {
    const { node, update } = await render(
      <DropdownMenu trigger="Open Menu">
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector<HTMLButtonElement>('.trigger')
    trigger?.click()
    await update()

    // Verify menu is open
    expect(node.textContent).toContain('Item 1')

    // Click the trigger again to close the menu
    trigger?.click()
    await update()

    // Verify menu is closed
    expect(node.textContent).not.toContain('Item 1')
  })

  test('closes on Escape key', async () => {
    const { node, update } = await render(
      <DropdownMenu trigger="Open Menu">
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector<HTMLButtonElement>('.trigger')
    trigger?.click()
    await update()

    // Verify menu is open
    expect(node.textContent).toContain('Item 1')

    // Press Escape key
    node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await update()

    // Verify menu is closed
    expect(node.textContent).not.toContain('Item 1')
  })

  test('calls onOpen when menu opens', async () => {
    const onOpen = mock()
    const { node, update } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>} onOpen={onOpen}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector<HTMLButtonElement>('.trigger')
    trigger?.click()
    await update()

    // Verify onOpen was called
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('calls onClose when menu closes', async () => {
    const onClose = mock()
    const { node, update } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>} onClose={onClose}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector<HTMLButtonElement>('.trigger')
    trigger?.click()
    await update()

    // Click the trigger again to close the menu
    trigger?.click()
    await update()

    // Verify onClose was called
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('calls onClose when clicking outside', async () => {
    const onClose = mock()
    const { node, update } = await render(
      <DropdownMenu trigger="Open Menu" onClose={onClose}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector<HTMLButtonElement>('.trigger')
    trigger?.click()
    await update()

    // Click the trigger again to close the menu (simulating close action)
    trigger?.click()
    await update()

    // Verify onClose was called
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('calls onClose when pressing Escape', async () => {
    const onClose = mock()
    const { node, update } = await render(
      <DropdownMenu trigger="Open Menu" onClose={onClose}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector<HTMLElement>('.trigger')
    trigger?.click()
    await update()

    // Press Escape key
    node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await update()

    // Verify onClose was called
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
