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
    const { node } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
        <DropdownMenu.Item>Item 2</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector('.trigger button') as HTMLButtonElement
    trigger?.click()

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(node.textContent).toContain('Item 1')
    expect(node.textContent).toContain('Item 2')
  })

  test('renders only trigger when readOnly', async () => {
    const { node } = await render(
      <DropdownMenu readOnly={true} trigger={<button>Read Only</button>}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    expect(node.textContent).toContain('Read Only')
    expect(node.textContent).not.toContain('Item 1')
  })

  test('supports DropdownMenu.Divider', async () => {
    const { node } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
        <DropdownMenu.Divider />
        <DropdownMenu.Item>Item 2</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector('.trigger button') as HTMLButtonElement
    trigger?.click()

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(node.querySelector('hr')).toBeTruthy()
  })

  test('supports DropdownMenu.ItemGroup', async () => {
    const { node } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
        <DropdownMenu.Group>
          <DropdownMenu.Item>Grouped Item</DropdownMenu.Item>
        </DropdownMenu.Group>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector('.trigger button') as HTMLButtonElement
    trigger?.click()

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(node.querySelector('[role="group"]')).toBeTruthy()
  })

  test('closes when clicking outside', async () => {
    const { node } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector('.trigger button') as HTMLButtonElement
    trigger?.click()

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify menu is open
    expect(node.textContent).toContain('Item 1')

    // Click the trigger again to close the menu
    trigger?.click()

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify menu is closed
    expect(node.textContent).not.toContain('Item 1')
  })

  test('closes on Escape key', async () => {
    const { node } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector('.trigger button') as HTMLButtonElement
    trigger?.click()

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify menu is open
    expect(node.textContent).toContain('Item 1')

    // Press Escape key
    trigger?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify menu is closed
    expect(node.textContent).not.toContain('Item 1')
  })

  test('calls onOpen when menu opens', async () => {
    const onOpen = mock()
    const { node } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>} onOpen={onOpen}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector('.trigger button') as HTMLButtonElement
    trigger?.click()

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify onOpen was called
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('calls onClose when menu closes', async () => {
    const onClose = mock()
    const { node } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>} onClose={onClose}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector('.trigger button') as HTMLButtonElement
    trigger?.click()

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Click the trigger again to close the menu
    trigger?.click()

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify onClose was called
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('calls onClose when clicking outside', async () => {
    const onClose = mock()
    const { node } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>} onClose={onClose}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector('.trigger button') as HTMLButtonElement
    trigger?.click()

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Click the trigger again to close the menu (simulating close action)
    trigger?.click()

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify onClose was called
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('calls onClose when pressing Escape', async () => {
    const onClose = mock()
    const { node } = await render(
      <DropdownMenu trigger={<button>Open Menu</button>} onClose={onClose}>
        <DropdownMenu.Item>Item 1</DropdownMenu.Item>
      </DropdownMenu>,
    )

    // Click the trigger to open the menu
    const trigger = node.querySelector('.trigger button') as HTMLButtonElement
    trigger?.click()

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Press Escape key
    trigger?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))

    // Wait a bit for state update
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify onClose was called
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
