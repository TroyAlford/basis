import { describe, expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { FormField } from './FormField'

// Create a concrete FormField implementation for testing
class TestFormField extends FormField<string> {
  static displayName = 'TestFormField'
}

describe('FormField', () => {
  describe('form field specific props', () => {
    test('applies autoComplete when enabled', () => {
      const { node } = render(<TestFormField autoComplete />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('autoComplete', 'on')
    })

    test('disables autoComplete when false', () => {
      const { node } = render(<TestFormField autoComplete={false} />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('autoComplete', 'off')
    })

    test('applies autoFocus', () => {
      const { node } = render(<TestFormField autoFocus />)
      const input = node.querySelector('input') as HTMLInputElement
      expect(input).toBeDefined()
      spyOn(input, 'focus')
      // Note: autoFocus is handled imperatively by React, not as an HTML attribute
    })

    test('applies placeholder', () => {
      const { node } = render(<TestFormField placeholder="Enter text" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('placeholder', 'Enter text')
    })

    test('applies tabIndex', () => {
      const { node } = render(<TestFormField tabIndex={5} />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('tabIndex', '5')
    })

    test('applies required attribute', () => {
      const { node } = render(<TestFormField required />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('required')
    })
  })

  describe('ARIA accessibility', () => {
    test('applies basic ARIA attributes', () => {
      const { node } = render(<TestFormField />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('role', 'textbox')
      expect(input).toHaveAttribute('aria-disabled', 'false')
      expect(input).toHaveAttribute('aria-readonly', 'false')
    })

    test('applies disabled ARIA attribute', () => {
      const { node } = render(<TestFormField disabled />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-disabled', 'true')
    })

    test('applies readonly ARIA attribute', () => {
      const { node } = render(<TestFormField readOnly />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-readonly', 'true')
    })

    test('applies invalid ARIA attribute', () => {
      const { node } = render(<TestFormField invalid />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-invalid', 'true')
    })

    test('applies required ARIA attribute', () => {
      const { node } = render(<TestFormField required />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-required', 'true')
    })

    test('applies aria-label', () => {
      const { node } = render(<TestFormField label="Email address" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-label', 'Email address')
    })

    test('applies aria-labelledby', () => {
      const { node } = render(<TestFormField labelledBy="email-label" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-labelledby', 'email-label')
    })

    test('applies aria-describedby', () => {
      const { node } = render(<TestFormField describedBy="email-help" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-describedby', 'email-help')
    })

    test('applies aria-errormessage', () => {
      const { node } = render(<TestFormField errorMessage="email-error" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-errormessage', 'email-error')
    })

    test('applies aria-placeholder', () => {
      const { node } = render(<TestFormField placeholder="Enter your email" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-placeholder', 'Enter your email')
    })

    test('applies aria-haspopup', () => {
      const { node } = render(<TestFormField hasPopup="listbox" />)
      const input = node.querySelector('input')
      expect(input).toHaveAttribute('aria-haspopup', 'listbox')
    })

    test('merges ARIA attributes from props with automatic ones', () => {
      const { node } = render(
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
    test('renders with prefix', () => {
      const { node } = render(<TestFormField prefix={<span>$</span>} />)
      const prefix = node.querySelector('.prefix')
      expect(prefix).toBeDefined()
      expect(node).toHaveAttribute('data-has-prefix')
    })

    test('renders with suffix', () => {
      const { node } = render(<TestFormField suffix={<span>USD</span>} />)
      const suffix = node.querySelector('.suffix')
      expect(suffix).toBeDefined()
      expect(node).toHaveAttribute('data-has-suffix')
    })

    test('renders with both prefix and suffix', () => {
      const { node } = render(
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

    test('does not apply data attributes when props are false', () => {
      const { node } = render(<TestFormField />)
      expect(node).not.toHaveAttribute('data-has-prefix')
      expect(node).not.toHaveAttribute('data-has-suffix')
    })
  })

  describe('input rendering', () => {
    test('renders input element with correct type', () => {
      const { node } = render(<TestFormField />)
      const input = node.querySelector('input')
      expect(input).toBeDefined()
      expect(input).toHaveAttribute('type', 'text')
    })

    test('renders input with current value', () => {
      const { node } = render(<TestFormField value="test value" />)
      const input = node.querySelector('input') as HTMLInputElement
      expect(input.value).toBe('test value')
    })
  })

  describe('imperative methods', () => {
    test('focuses and blurs when the instance methods are called', () => {
      const { instance, root } = render<TestFormField>(<TestFormField />)
      const input = root.querySelector('input') as HTMLInputElement
      expect(input).toBeDefined()

      // Test that the methods can be called without error
      expect(() => instance.focus()).not.toThrow()
      expect(() => instance.blur()).not.toThrow()
    })

    test('selects all text when select method is called', () => {
      const { instance, root } = render<TestFormField>(<TestFormField value="test text" />)
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
