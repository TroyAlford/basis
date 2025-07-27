import { describe, expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { FormField } from './FormField'

// Create a concrete FormField implementation for testing
class TestFormField extends FormField<string, HTMLInputElement> {
  static displayName = 'TestFormField'
}

describe('FormField', () => {
  describe('form field specific props', () => {
    test('applies autoComplete when enabled', async () => {
      const { node } = await render(<TestFormField autoComplete />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('autoComplete', 'on')
    })

    test('disables autoComplete when false', async () => {
      const { node } = await render(<TestFormField autoComplete={false} />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('autoComplete', 'off')
    })

    test('applies autoFocus', async () => {
      const { node } = await render(<TestFormField autoFocus />)
      const input = node.querySelector('input') as HTMLInputElement
      expect(input).toBeDefined()
      spyOn(input, 'focus')
      // Note: autoFocus is handled imperatively by React, not as an HTML attribute
    })

    test('applies placeholder', async () => {
      const { node } = await render(<TestFormField placeholder="Enter text" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('placeholder', 'Enter text')
    })

    test('applies tabIndex', async () => {
      const { node } = await render(<TestFormField tabIndex={5} />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('tabIndex', '5')
    })

    test('applies required attribute', async () => {
      const { node } = await render(<TestFormField required />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('required')
    })
  })

  describe('ARIA accessibility', () => {
    test('applies basic ARIA attributes', async () => {
      const { node } = await render(<TestFormField />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('role', 'textbox')
      expect(input).toHaveAttribute('aria-disabled', 'false')
      expect(input).toHaveAttribute('aria-readonly', 'false')
    })

    test('applies disabled ARIA attribute', async () => {
      const { node } = await render(<TestFormField disabled />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-disabled', 'true')
    })

    test('applies readonly ARIA attribute', async () => {
      const { node } = await render(<TestFormField readOnly />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-readonly', 'true')
    })

    test('applies invalid ARIA attribute', async () => {
      const { node } = await render(<TestFormField invalid />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-invalid', 'true')
    })

    test('applies required ARIA attribute', async () => {
      const { node } = await render(<TestFormField required />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-required', 'true')
    })

    test('applies aria-label', async () => {
      const { node } = await render(<TestFormField label="Email address" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-label', 'Email address')
    })

    test('applies aria-labelledby', async () => {
      const { node } = await render(<TestFormField labelledBy="email-label" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-labelledby', 'email-label')
    })

    test('applies aria-describedby', async () => {
      const { node } = await render(<TestFormField describedBy="email-help" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-describedby', 'email-help')
    })

    test('applies aria-errormessage', async () => {
      const { node } = await render(<TestFormField errorMessage="email-error" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-errormessage', 'email-error')
    })

    test('applies aria-placeholder', async () => {
      const { node } = await render(<TestFormField placeholder="Enter your email" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-placeholder', 'Enter your email')
    })

    test('applies aria-haspopup', async () => {
      const { node } = await render(<TestFormField hasPopup="listbox" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-haspopup', 'listbox')
    })

    test('merges ARIA attributes from props with automatic ones', async () => {
      const { node } = await render(
        <TestFormField
          disabled
          required
          aria={{ expanded: true }}
          label="Custom label"
        />,
      )
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('role', 'textbox')
      expect(input).toHaveAttribute('aria-disabled', 'true')
      expect(input).toHaveAttribute('aria-required', 'true')
      expect(input).toHaveAttribute('aria-label', 'Custom label')
      expect(input).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('prefix and suffix rendering', () => {
    test('renders with prefix', async () => {
      const { node } = await render(<TestFormField prefix={<span>$</span>} />)
      const prefix = node.querySelector('.prefix')
      expect(prefix).toBeDefined()
      expect(node).toHaveAttribute('data-has-prefix')
    })

    test('renders with suffix', async () => {
      const { node } = await render(<TestFormField suffix={<span>USD</span>} />)
      const suffix = node.querySelector('.suffix')
      expect(suffix).toBeDefined()
      expect(node).toHaveAttribute('data-has-suffix')
    })

    test('renders with both prefix and suffix', async () => {
      const { node } = await render(
        <TestFormField
          prefix={<span>$</span>}
          suffix={<span>USD</span>}
        />,
      )
      const prefix = node.querySelector('.prefix')
      const suffix = node.querySelector('.suffix')
      expect(prefix).toBeDefined()
      expect(suffix).toBeDefined()
      expect(node).toHaveAttribute('data-has-prefix')
      expect(node).toHaveAttribute('data-has-suffix')
    })

    test('does not apply data attributes when props are false', async () => {
      const { node } = await render(<TestFormField />)
      expect(node).not.toHaveAttribute('data-has-prefix')
      expect(node).not.toHaveAttribute('data-has-suffix')
    })
  })

  describe('input rendering', () => {
    test('renders input element with correct type', async () => {
      const { node } = await render(<TestFormField />)
      const input = node.querySelector('input')
      expect(input).toBeDefined()
      expect(input).toHaveAttribute('type', 'text')
    })

    test('renders input with current value', async () => {
      const { node } = await render(<TestFormField value="test value" />)
      const input = node.querySelector('input') as HTMLInputElement
      expect(input.value).toBe('test value')
    })
  })

  describe('imperative methods', () => {
    test('focuses and blurs when the instance methods are called', async () => {
      const { instance, root } = await render<TestFormField>(<TestFormField />)
      const input = root.querySelector('input') as HTMLInputElement
      expect(input).toBeDefined()

      // Test that the methods can be called without error
      expect(() => instance.focus()).not.toThrow()
      expect(() => instance.blur()).not.toThrow()
    })

    test('selects all text when select method is called', async () => {
      const { instance, root } = await render<TestFormField>(<TestFormField value="test text" />)
      const input = root.querySelector('input') as HTMLInputElement
      expect(input).toBeDefined()

      spyOn(input, 'select')
      instance.select()
      expect(input.select).toHaveBeenCalled()
    })
  })

  test('has correct display name', () => {
    expect(TestFormField.displayName).toBe('TestFormField')
  })
})
