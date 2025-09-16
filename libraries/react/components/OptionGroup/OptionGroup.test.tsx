import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Orientation } from '../../types/Orientation'
import { OptionGroup } from './OptionGroup'

describe('OptionGroup', () => {
  describe('rendering', () => {
    test('renders radio buttons when multiple is false', async () => {
      const { node } = await render(
        <OptionGroup
          multiple={false}
          value="option1"
        >
          <OptionGroup.Option value="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option value="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option value="option3">Option 3</OptionGroup.Option>
        </OptionGroup>,
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
          multiple={true}
          value={['option1', 'option3']}
        >
          <OptionGroup.Option value="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option value="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option value="option3">Option 3</OptionGroup.Option>
        </OptionGroup>,
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
          multiple={false}
          orientation={Orientation.Horizontal}
          value="option1"
        >
          <OptionGroup.Option value="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option value="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option value="option3">Option 3</OptionGroup.Option>
        </OptionGroup>,
      )

      expect(node).toHaveAttribute('data-orientation', 'horizontal')
    })

    test('renders vertical orientation by default', async () => {
      const { node } = await render(
        <OptionGroup
          multiple={false}
          value="option1"
        >
          <OptionGroup.Option value="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option value="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option value="option3">Option 3</OptionGroup.Option>
        </OptionGroup>,
      )

      expect(node).toHaveAttribute('data-orientation', 'vertical')
    })

    test('uses proper ARIA attributes', async () => {
      const { node } = await render(
        <OptionGroup
          aria-label="Test options"
          multiple={false}
          value="option1"
        >
          <OptionGroup.Option value="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option value="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option value="option3">Option 3</OptionGroup.Option>
        </OptionGroup>,
      )

      expect(node).toHaveAttribute('aria-label', 'Test options')
      expect(node).toHaveAttribute('role', 'radiogroup')
    })

    test('handles disabled options', async () => {
      const { node } = await render(
        <OptionGroup
          multiple={false}
          value="option1"
        >
          <OptionGroup.Option value="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option disabled value="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option value="option3">Option 3</OptionGroup.Option>
        </OptionGroup>,
      )

      const inputs = node.querySelectorAll('input')
      expect(inputs[1]).toHaveAttribute('disabled', '')
    })

    test('renders in read-only mode', async () => {
      const { node } = await render(
        <OptionGroup
          multiple={false}
          readOnly={true}
          value="option1"
        >
          <OptionGroup.Option value="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option value="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option value="option3">Option 3</OptionGroup.Option>
        </OptionGroup>,
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
          multiple={false}
          value="option1"
          onChange={onChange}
        >
          <OptionGroup.Option value="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option value="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option value="option3">Option 3</OptionGroup.Option>
        </OptionGroup>,
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
          multiple={false}
          value="option2"
          onChange={onChange}
        >
          <OptionGroup.Option value="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option value="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option value="option3">Option 3</OptionGroup.Option>
        </OptionGroup>,
      )

      // Verify the controlled value is respected
      const inputs = node.querySelectorAll('input')
      expect(inputs[1]).toHaveAttribute('checked', '')
    })

    test('handles uncontrolled mode', async () => {
      const onChange = mock()
      const { node } = await render(
        <OptionGroup
          initialValue="option3"
          multiple={false}
          onChange={onChange}
        >
          <OptionGroup.Option value="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option value="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option value="option3">Option 3</OptionGroup.Option>
        </OptionGroup>,
      )

      // Verify the initial value is respected
      const inputs = node.querySelectorAll('input')
      expect(inputs[2]).toHaveAttribute('checked', '')
    })
  })

  describe('generic types', () => {
    test('handles number values', async () => {
      const onChange = mock()
      const { node } = await render(
        <OptionGroup<number>
          multiple={false}
          value={2}
          onChange={onChange}
        >
          <OptionGroup.Option value={1}>One</OptionGroup.Option>
          <OptionGroup.Option value={2}>Two</OptionGroup.Option>
          <OptionGroup.Option value={3}>Three</OptionGroup.Option>
        </OptionGroup>,
      )

      // Verify the number value is handled correctly
      const inputs = node.querySelectorAll('input')
      expect(inputs[1]).toHaveAttribute('checked', '')
      expect(inputs[1]).toHaveAttribute('value', '2')
    })
  })
})
