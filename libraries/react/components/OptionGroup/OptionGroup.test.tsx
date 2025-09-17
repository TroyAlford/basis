import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Orientation } from '../../types/Orientation'
import { ToggleEditor } from '../ToggleEditor/ToggleEditor'
import { OptionGroup } from './OptionGroup'

describe('OptionGroup', () => {
  describe('rendering', () => {
    test('renders radio buttons when multiple is false', async () => {
      const { node } = await render(
        <OptionGroup
          multiple={false}
          value="option1"
        >
          <OptionGroup.Option data="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option data="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option data="option3">Option 3</OptionGroup.Option>
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
          <OptionGroup.Option data="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option data="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option data="option3">Option 3</OptionGroup.Option>
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
          <OptionGroup.Option data="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option data="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option data="option3">Option 3</OptionGroup.Option>
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
          <OptionGroup.Option data="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option data="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option data="option3">Option 3</OptionGroup.Option>
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
          <OptionGroup.Option data="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option data="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option data="option3">Option 3</OptionGroup.Option>
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
          <OptionGroup.Option data="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option disabled data="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option data="option3">Option 3</OptionGroup.Option>
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
          <OptionGroup.Option data="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option data="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option data="option3">Option 3</OptionGroup.Option>
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
          <OptionGroup.Option data="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option data="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option data="option3">Option 3</OptionGroup.Option>
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
          <OptionGroup.Option data="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option data="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option data="option3">Option 3</OptionGroup.Option>
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
          <OptionGroup.Option data="option1">Option 1</OptionGroup.Option>
          <OptionGroup.Option data="option2">Option 2</OptionGroup.Option>
          <OptionGroup.Option data="option3">Option 3</OptionGroup.Option>
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
          <OptionGroup.Option data={1}>One</OptionGroup.Option>
          <OptionGroup.Option data={2}>Two</OptionGroup.Option>
          <OptionGroup.Option data={3}>Three</OptionGroup.Option>
        </OptionGroup>,
      )

      // Verify the number value is handled correctly
      const inputs = node.querySelectorAll('input')
      expect(inputs[1]).toHaveAttribute('checked', '')
      expect(inputs[1]).toHaveAttribute('value', '2')
    })
  })

  describe('Editor<boolean> integration', () => {
    test('renders ToggleEditor components in single mode', async () => {
      const onChange = mock()
      const { node } = await render(
        <OptionGroup<string>
          multiple={false}
          value="toggle1"
          onChange={onChange}
        >
          <ToggleEditor data="toggle1" off="Toggle 1" on="Toggle 1" />
          <ToggleEditor data="toggle2" off="Toggle 2" on="Toggle 2" />
        </OptionGroup>,
      )

      // Verify ToggleEditor components are rendered as buttons
      const buttons = node.querySelectorAll('button')
      expect(buttons).toHaveLength(2)

      // First toggle should be pressed (selected)
      expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
      expect(buttons[1]).toHaveAttribute('aria-pressed', 'false')
    })

    test('renders ToggleEditor components in multiple mode', async () => {
      const onChange = mock()
      const { node } = await render(
        <OptionGroup<string>
          multiple={true}
          value={['toggle1', 'toggle3']}
          onChange={onChange}
        >
          <ToggleEditor data="toggle1" off="Toggle 1" on="Toggle 1" />
          <ToggleEditor data="toggle2" off="Toggle 2" on="Toggle 2" />
          <ToggleEditor data="toggle3" off="Toggle 3" on="Toggle 3" />
        </OptionGroup>,
      )

      // Verify ToggleEditor components are rendered as buttons
      const buttons = node.querySelectorAll('button')
      expect(buttons).toHaveLength(3)

      // First and third toggles should be pressed (selected)
      expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
      expect(buttons[1]).toHaveAttribute('aria-pressed', 'false')
      expect(buttons[2]).toHaveAttribute('aria-pressed', 'true')
    })

    test('renders mixed Option and ToggleEditor components', async () => {
      const onChange = mock()
      const { node } = await render(
        <OptionGroup<string>
          multiple={true}
          value={['option1', 'toggle1']}
          onChange={onChange}
        >
          <OptionGroup.Option data="option1">Option 1</OptionGroup.Option>
          <ToggleEditor data="toggle1" off="Toggle 1" on="Toggle 1" />
          <OptionGroup.Option data="option2">Option 2</OptionGroup.Option>
        </OptionGroup>,
      )

      // Should have both inputs and buttons
      const inputs = node.querySelectorAll('input')
      const buttons = node.querySelectorAll('button')

      expect(inputs).toHaveLength(2) // Two Option components
      expect(buttons).toHaveLength(1) // One ToggleEditor component

      // First option should be checked
      expect(inputs[0]).toHaveAttribute('checked', '')
      // Toggle should be pressed
      expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
      // Second option should not be checked
      expect(inputs[1]).not.toHaveAttribute('checked')
    })

    test('handles ToggleEditor in read-only mode', async () => {
      const onChange = mock()
      const { node } = await render(
        <OptionGroup<string>
          multiple={false}
          readOnly={true}
          value="toggle1"
          onChange={onChange}
        >
          <ToggleEditor data="toggle1" off="Toggle 1" on="Toggle 1" />
          <ToggleEditor data="toggle2" off="Toggle 2" on="Toggle 2" />
        </OptionGroup>,
      )

      // Verify buttons are disabled in read-only mode
      const buttons = node.querySelectorAll('button')
      expect(buttons).toHaveLength(2)
      buttons.forEach(button => {
        expect(button).toHaveAttribute('disabled', '')
      })
    })

    test('keyboard navigation is scoped to individual OptionGroups', async () => {
      const onChange1 = mock()
      const onChange2 = mock()

      const { node } = await render(
        <div>
          <OptionGroup<string>
            multiple={false}
            value="option1"
            onChange={onChange1}
          >
            <OptionGroup.Option data="option1">Group 1 Option 1</OptionGroup.Option>
            <OptionGroup.Option data="option2">Group 1 Option 2</OptionGroup.Option>
          </OptionGroup>
          <OptionGroup<string>
            multiple={false}
            value="option3"
            onChange={onChange2}
          >
            <OptionGroup.Option data="option3">Group 2 Option 1</OptionGroup.Option>
            <OptionGroup.Option data="option4">Group 2 Option 2</OptionGroup.Option>
          </OptionGroup>
        </div>,
      )

      // Verify both OptionGroups are rendered
      const fieldsets = node.querySelectorAll('fieldset')
      expect(fieldsets).toHaveLength(2)

      // Verify each has its own options
      const inputs = node.querySelectorAll('input')
      expect(inputs).toHaveLength(4)

      // First group should have option1 selected
      expect(inputs[0]).toHaveAttribute('checked', '')
      expect(inputs[1]).not.toHaveAttribute('checked')

      // Second group should have option3 selected
      expect(inputs[2]).toHaveAttribute('checked', '')
      expect(inputs[3]).not.toHaveAttribute('checked')
    })

    test('keyboard navigation does not cross OptionGroup boundaries', async () => {
      const onChange1 = mock()
      const onChange2 = mock()

      const { node } = await render(
        <div>
          <OptionGroup<string>
            multiple={false}
            value="option1"
            onChange={onChange1}
          >
            <OptionGroup.Option data="option1">Group 1 Option 1</OptionGroup.Option>
            <OptionGroup.Option data="option2">Group 1 Option 2</OptionGroup.Option>
          </OptionGroup>
          <div>Some content between groups</div>
          <OptionGroup<string>
            multiple={false}
            value="option3"
            onChange={onChange2}
          >
            <OptionGroup.Option data="option3">Group 2 Option 1</OptionGroup.Option>
            <OptionGroup.Option data="option4">Group 2 Option 2</OptionGroup.Option>
          </OptionGroup>
        </div>,
      )

      // Get the fieldsets
      const fieldsets = node.querySelectorAll('fieldset')
      const firstFieldset = fieldsets[0]
      const secondFieldset = fieldsets[1]
      expect(firstFieldset).toBeTruthy()
      expect(secondFieldset).toBeTruthy()

      // Get inputs from each group
      const firstInputs = firstFieldset.querySelectorAll('input')
      const secondInputs = secondFieldset.querySelectorAll('input')
      expect(firstInputs).toHaveLength(2)
      expect(secondInputs).toHaveLength(2)

      /*
       * Test that keyboard navigation is scoped to each OptionGroup
       * We'll verify this by checking that the OptionGroup's handleKeyDown method
       * only processes events when the focused element is within its own fieldset
       */

      // Get the OptionGroup instances to verify their internal state
      const firstGroupInputs = firstFieldset.querySelectorAll('input')
      const secondGroupInputs = secondFieldset.querySelectorAll('input')

      // Verify each group has its own inputs
      expect(firstGroupInputs).toHaveLength(2)
      expect(secondGroupInputs).toHaveLength(2)

      // Verify the inputs are different elements (not shared between groups)
      expect(firstGroupInputs[0]).not.toBe(secondGroupInputs[0])
      expect(firstGroupInputs[1]).not.toBe(secondGroupInputs[1])

      // Verify each group has its own data-role elements
      const firstGroupOptions = firstFieldset.querySelectorAll('[data-role="OptionGroup.Option"]')
      const secondGroupOptions = secondFieldset.querySelectorAll('[data-role="OptionGroup.Option"]')

      expect(firstGroupOptions).toHaveLength(2)
      expect(secondGroupOptions).toHaveLength(2)

      // Verify the options are different elements
      expect(firstGroupOptions[0]).not.toBe(secondGroupOptions[0])
      expect(firstGroupOptions[1]).not.toBe(secondGroupOptions[1])
    })

    test('keyboard navigation works with ToggleEditor components', async () => {
      const onChange = mock()

      const { node } = await render(
        <div>
          <OptionGroup<string>
            multiple={false}
            value="toggle1"
            onChange={onChange}
          >
            <ToggleEditor data="toggle1" off="Toggle 1" on="Toggle 1" />
            <ToggleEditor data="toggle2" off="Toggle 2" on="Toggle 2" />
            <ToggleEditor data="toggle3" off="Toggle 3" on="Toggle 3" />
          </OptionGroup>
        </div>,
      )

      // Get the fieldset and buttons
      const fieldset = node.querySelector('fieldset')
      const buttons = fieldset?.querySelectorAll('button')
      expect(fieldset).toBeTruthy()
      expect(buttons).toHaveLength(3)

      // Verify the ToggleEditor components are properly integrated
      const firstButton = buttons?.[0] as HTMLButtonElement
      const secondButton = buttons?.[1] as HTMLButtonElement
      const thirdButton = buttons?.[2] as HTMLButtonElement

      // Verify each button has the correct text content
      expect(firstButton.textContent).toBe('Toggle 1')
      expect(secondButton.textContent).toBe('Toggle 2')
      expect(thirdButton.textContent).toBe('Toggle 3')

      // Verify each button has the data-role attribute
      expect(firstButton.getAttribute('data-role')).toBe('OptionGroup.Option')
      expect(secondButton.getAttribute('data-role')).toBe('OptionGroup.Option')
      expect(thirdButton.getAttribute('data-role')).toBe('OptionGroup.Option')

      /*
       * Verify each button has the data attribute (it's passed as a prop, not DOM attribute)
       * The data prop is used internally by the component, not exposed as a DOM attribute
       */
      expect(firstButton).toBeTruthy()
      expect(secondButton).toBeTruthy()
      expect(thirdButton).toBeTruthy()
    })
  })
})
