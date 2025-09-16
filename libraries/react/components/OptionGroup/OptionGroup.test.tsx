import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { OptionGroup } from './OptionGroup'

describe('OptionGroup', () => {
  const testOptions = [
    { value: 'option1', label: 'Option 1' },
    { value: 'option2', label: 'Option 2' },
    { value: 'option3', label: 'Option 3' },
  ]

  describe('rendering', () => {
    test('renders radio buttons when multiple is false', async () => {
      const { node } = await render(
        <OptionGroup
          options={testOptions}
          multiple={false}
          value="option1"
          onChange={() => {}}
        />
      )

      const inputs = node.querySelectorAll('input[type="radio"]')
      expect(inputs).toHaveLength(3)
      expect(inputs[0]).toHaveAttribute('checked', '')
      expect(inputs[1]).not.toHaveAttribute('checked')
      expect(inputs[2]).not.toHaveAttribute('checked')
    })

    test('renders checkboxes when multiple is true', async () => {
      const { node } = await render(
        <OptionGroup
          options={testOptions}
          multiple={true}
          value={['option1', 'option3']}
          onChange={() => {}}
        />
      )

      const inputs = node.querySelectorAll('input[type="checkbox"]')
      expect(inputs).toHaveLength(3)
      expect(inputs[0]).toHaveAttribute('checked', '')
      expect(inputs[1]).not.toHaveAttribute('checked')
      expect(inputs[2]).toHaveAttribute('checked', '')
    })

    test('renders horizontal orientation', async () => {
      const { node } = await render(
        <OptionGroup
          options={testOptions}
          multiple={false}
          orientation="horizontal"
          value="option1"
          onChange={() => {}}
        />
      )

      const container = node.querySelector('.option-group-container')
      expect(container).toHaveClass('horizontal')
    })

    test('renders vertical orientation by default', async () => {
      const { node } = await render(
        <OptionGroup
          options={testOptions}
          multiple={false}
          value="option1"
          onChange={() => {}}
        />
      )

      const container = node.querySelector('.option-group-container')
      expect(container).toHaveClass('vertical')
    })

    test('uses proper ARIA attributes', async () => {
      const { node } = await render(
        <OptionGroup
          options={testOptions}
          multiple={false}
          value="option1"
          aria-label="Test options"
          onChange={() => {}}
        />
      )

      expect(node).toHaveAttribute('aria-label', 'Test options')
      expect(node).toHaveAttribute('role', 'radiogroup')
    })

    test('handles disabled options', async () => {
      const disabledOptions = [
        { value: 'option1', label: 'Option 1' },
        { value: 'option2', label: 'Option 2', disabled: true },
        { value: 'option3', label: 'Option 3' },
      ]

      const { node } = await render(
        <OptionGroup
          options={disabledOptions}
          multiple={false}
          value="option1"
          onChange={() => {}}
        />
      )

      const inputs = node.querySelectorAll('input')
      expect(inputs[1]).toHaveAttribute('disabled', '')
    })

    test('renders in read-only mode', async () => {
      const { node } = await render(
        <OptionGroup
          options={testOptions}
          multiple={false}
          value="option1"
          readOnly={true}
          onChange={() => {}}
        />
      )

      const inputs = node.querySelectorAll('input')
      inputs.forEach(input => {
        expect(input).toHaveAttribute('disabled', '')
      })
    })
  })

  describe('event handling', () => {
    test('renders with onChange handler', async () => {
      const onChange = mock()
      const { node } = await render(
        <OptionGroup
          options={testOptions}
          multiple={false}
          value="option1"
          onChange={onChange}
        />
      )

      // Verify the component renders with the handler
      expect(node).toBeTruthy()
      const inputs = node.querySelectorAll('input')
      expect(inputs).toHaveLength(3)
    })

    test('handles controlled mode', async () => {
      const onChange = mock()
      const { node } = await render(
        <OptionGroup
          options={testOptions}
          multiple={false}
          value="option2"
          onChange={onChange}
        />
      )

      // Verify the controlled value is respected
      const inputs = node.querySelectorAll('input')
      expect(inputs[1]).toHaveAttribute('checked', '')
    })

    test('handles uncontrolled mode', async () => {
      const onChange = mock()
      const { node } = await render(
        <OptionGroup
          options={testOptions}
          multiple={false}
          initialValue="option3"
          onChange={onChange}
        />
      )

      // Verify the initial value is respected
      const inputs = node.querySelectorAll('input')
      expect(inputs[2]).toHaveAttribute('checked', '')
    })
  })

  describe('generic types', () => {
    test('handles number values', async () => {
      const numberOptions = [
        { value: 1, label: 'One' },
        { value: 2, label: 'Two' },
        { value: 3, label: 'Three' },
      ]

      const onChange = mock()
      const { node } = await render(
        <OptionGroup<number>
          options={numberOptions}
          multiple={false}
          value={2}
          onChange={onChange}
        />
      )

      // Verify the number value is handled correctly
      const inputs = node.querySelectorAll('input')
      expect(inputs[1]).toHaveAttribute('checked', '')
      expect(inputs[1]).toHaveAttribute('value', '2')
    })
  })
})
