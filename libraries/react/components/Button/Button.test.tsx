import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Button } from './Button'

describe('Button', () => {
  describe('rendering', () => {
    test('renders with default props', async () => {
      const { node } = await render(<Button>Click me</Button>)
      expect(node.tagName).toBe('BUTTON')
      expect(node).toHaveClass('button', 'component')
      expect(node).not.toHaveAttribute('disabled')
      expect(node).toHaveAttribute('type', 'button')
      expect(node.textContent).toBe('Click me')
    })

    test('renders with custom type', async () => {
      const { node } = await render(<Button type={Button.Type.Submit}>Submit</Button>)
      expect(node).toHaveAttribute('type', 'submit')
    })

    test('renders in disabled state', async () => {
      const { node } = await render(<Button disabled>Disabled</Button>)
      expect(node).toHaveAttribute('disabled', '')
    })
  })

  describe('event handling', () => {
    test('calls onActivate when clicked', async () => {
      const onActivate = mock()
      const { node } = await render(<Button onActivate={onActivate}>Click me</Button>)

      node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    test('calls onActivate on Enter key', async () => {
      const onActivate = mock()
      const { node } = await render(<Button onActivate={onActivate}>Press Enter</Button>)

      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    test('calls onActivate on Space key', async () => {
      const onActivate = mock()
      const { node } = await render(<Button onActivate={onActivate}>Press Space</Button>)

      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    test('does not call onActivate on other keys', async () => {
      const onActivate = mock()
      const { node } = await render(<Button onActivate={onActivate}>Press Tab</Button>)

      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }))
      expect(onActivate).not.toHaveBeenCalled()
    })

    test('calls onActivate on primary pointer button', async () => {
      const onActivate = mock()
      const { node } = await render(<Button onActivate={onActivate}>Click me</Button>)

      node.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    test('does not call onActivate on non-primary pointer button', async () => {
      const onActivate = mock()
      const { node } = await render(<Button onActivate={onActivate}>Right click</Button>)

      node.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 2 }))
      expect(onActivate).not.toHaveBeenCalled()
    })

    test('does not call onActivate when disabled', async () => {
      const onActivate = mock()
      const { node } = await render(<Button disabled onActivate={onActivate}>Disabled</Button>)

      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }))

      expect(onActivate).not.toHaveBeenCalled()
    })
  })

  describe('accessibility', () => {
    test('passes through direct aria-* props', async () => {
      const { node } = await render(
        <Button
          aria-controls="menu-1"
          aria-expanded="true"
          aria-haspopup="true"
        >
          Menu
        </Button>,
      )
      expect(node).toHaveAttribute('aria-expanded', 'true')
      expect(node).toHaveAttribute('aria-haspopup', 'true')
      expect(node).toHaveAttribute('aria-controls', 'menu-1')
    })

    test('sets aria-disabled based on disabled prop', async () => {
      const enabled = await render(<Button>Enabled</Button>)
      expect(enabled.node).toHaveAttribute('aria-disabled', 'false')

      const disabled = await render(<Button disabled>Disabled</Button>)
      expect(disabled.node).toHaveAttribute('aria-disabled', 'true')
    })

    test('disabled prop overrides aria-disabled from props', async () => {
      const { node } = await render(<Button disabled>Disabled</Button>)
      expect(node).toHaveAttribute('aria-disabled', 'true')
    })
  })
})
