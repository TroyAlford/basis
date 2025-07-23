import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Button } from './Button'

describe('Button', () => {
  describe('rendering', () => {
    test('renders with default props', () => {
      const { node } = render(<Button>Click me</Button>)
      expect(node.tagName).toBe('BUTTON')
      expect(node).toHaveClass('button', 'component')
      expect(node).not.toHaveAttribute('disabled')
      expect(node).toHaveAttribute('type', 'button')
      expect(node.textContent).toBe('Click me')
    })

    test('renders with custom type', () => {
      const { node } = render(<Button type={Button.Type.Submit}>Submit</Button>)
      expect(node).toHaveAttribute('type', 'submit')
    })

    test('renders in disabled state', () => {
      const { node } = render(<Button disabled>Disabled</Button>)
      expect(node).toHaveAttribute('disabled', '')
    })
  })

  describe('event handling', () => {
    test('calls onActivate when pointer down', () => {
      const onActivate = mock()
      const { node } = render(<Button onActivate={onActivate}>Click me</Button>)

      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    test('calls onActivate on Enter key', () => {
      const onActivate = mock()
      const { node } = render(<Button onActivate={onActivate}>Press Enter</Button>)

      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    test('calls onActivate on Space key', () => {
      const onActivate = mock()
      const { node } = render(<Button onActivate={onActivate}>Press Space</Button>)

      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    test('does not call onActivate on other keys', () => {
      const onActivate = mock()
      const { node } = render(<Button onActivate={onActivate}>Press Tab</Button>)

      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }))
      expect(onActivate).not.toHaveBeenCalled()
    })

    test('calls onActivate on primary pointer button', () => {
      const onActivate = mock()
      const { node } = render(<Button onActivate={onActivate}>Click me</Button>)

      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    test('does not call onActivate on non-primary pointer button', () => {
      const onActivate = mock()
      const { node } = render(<Button onActivate={onActivate}>Right click</Button>)

      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 }))
      expect(onActivate).not.toHaveBeenCalled()
    })

    test('does not call onActivate when disabled', () => {
      const onActivate = mock()
      const { node } = render(<Button disabled onActivate={onActivate}>Disabled</Button>)

      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))

      expect(onActivate).not.toHaveBeenCalled()
    })
  })

  describe('accessibility', () => {
    test('passes through direct aria-* props', () => {
      const { node } = render(
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

    test('passes through aria object props', () => {
      const { node } = render(
        <Button
          aria={{
            controls: 'menu-1',
            expanded: true,
            haspopup: true,
          }}
        >
          Menu
        </Button>,
      )
      expect(node).toHaveAttribute('aria-expanded', 'true')
      expect(node).toHaveAttribute('aria-haspopup', 'true')
      expect(node).toHaveAttribute('aria-controls', 'menu-1')
    })

    test('merges direct aria-* props with aria object props', () => {
      const { node } = render(
        <Button
          aria-expanded="false"
          aria-haspopup="true"
          aria={{
            controls: 'menu-1',
            expanded: true,
          }}
        >
          Menu
        </Button>,
      )
      // Direct props should take precedence
      expect(node).toHaveAttribute('aria-expanded', 'false')
      expect(node).toHaveAttribute('aria-haspopup', 'true')
      expect(node).toHaveAttribute('aria-controls', 'menu-1')
    })

    test('sets aria-disabled based on disabled prop', () => {
      const enabled = render(<Button>Enabled</Button>)
      expect(enabled.node).toHaveAttribute('aria-disabled', 'false')

      const disabled = render(<Button disabled>Disabled</Button>)
      expect(disabled.node).toHaveAttribute('aria-disabled', 'true')
    })

    test('disabled prop overrides aria-disabled from props', () => {
      const { node } = render(
        <Button
          disabled
          aria={{ disabled: false }}
          aria-disabled="false"
        >
          Disabled
        </Button>,
      )
      expect(node).toHaveAttribute('aria-disabled', 'true')
    })
  })
})
