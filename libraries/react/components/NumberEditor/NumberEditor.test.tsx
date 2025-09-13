import { beforeEach, describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { Keyboard } from '../../types/Keyboard'
import { NumberEditor } from './NumberEditor'

describe('NumberEditor', () => {
  const getInput = (node: Element) => node.querySelector('input') as HTMLInputElement

  // Shared mocks
  let onChange: ReturnType<typeof mock>
  let onKeyDown: ReturnType<typeof mock>

  beforeEach(() => {
    onChange = mock()
    onKeyDown = mock()
  })

  describe('number formatting in input', () => {
    test.each([
      { description: 'large numbers with commas', expected: '1,234,567', value: 1234567 },
      { description: 'zero as empty string', expected: '', value: 0 },
      { description: 'single digit without commas', expected: '5', value: 5 },
      { description: '3 digits without commas', expected: '123', value: 123 },
      { description: '4 digits with comma', expected: '1,234', value: 1234 },
      { description: '5 digits with comma', expected: '12,345', value: 12345 },
      { description: '6 digits with comma', expected: '123,456', value: 123456 },
    ])('formats $description', async ({ expected, value }) => {
      const { node } = await render(<NumberEditor value={value} onChange={onChange} />)
      const input = getInput(node)
      expect(input.value).toBe(expected)
    })
  })

  describe('readOnly behavior', () => {
    test.each([
      { description: 'large numbers', expected: '1,234,567', value: 1234567 },
      { description: 'zero', expected: '0', value: 0 },
      { description: 'single digit', expected: '5', value: 5 },
      { description: '3 digits', expected: '123', value: 123 },
      { description: '4 digits', expected: '1,234', value: 1234 },
      { description: 'very large numbers', expected: '1,234,567,890', value: 1234567890 },
      { description: 'negative numbers', expected: '-1,234,567', value: -1234567 },
      { description: 'small negative numbers', expected: '-5', value: -5 },
    ])('formats $description in readOnly mode', async ({ expected, value }) => {
      const { node } = await render(<NumberEditor readOnly value={value} onChange={onChange} />)

      const input = node.querySelector('input')
      expect(input).toBeNull()
      expect(node.textContent).toBe(expected)
    })

    test.each([
      { description: 'null value', expected: '', value: null },
      { description: 'undefined value', expected: '', value: undefined },
    ])('handles $description in readOnly mode', async ({ expected, value }) => {
      const { node } = await render(<NumberEditor readOnly value={value} onChange={onChange} />)

      const input = node.querySelector('input')
      expect(input).toBeNull()
      expect(node.textContent).toBe(expected)
    })
  })

  describe('value changes and parsing', () => {
    test.each([
      { description: 'comma-separated input', expected: 1234, input: '1,234' },
      { description: 'single digit', expected: 5, input: '5' },
      { description: 'multiple commas', expected: 1234567, input: '1,234,567' },
      { description: 'zero input', expected: 0, input: '0' },
      { description: 'plain number', expected: 123, input: '123' },
    ])('parses $description correctly', async ({ expected, input }) => {
      const { node } = await render(<NumberEditor onChange={onChange} />)
      const numberInput = getInput(node)

      await expect(Simulate.change(numberInput, input)).toRaise(onChange, expected)
    })

    test('parses empty input as zero when starting with non-zero value', async () => {
      const { node } = await render(<NumberEditor initialValue={123} onChange={onChange} />)
      const numberInput = getInput(node)

      await expect(Simulate.change(numberInput, '')).toRaise(onChange, 0)
    })

    test('does not call onChange when value does not change', async () => {
      const { node } = await render(<NumberEditor initialValue={0} onChange={onChange} />)
      const numberInput = getInput(node)

      // Change to empty string, which should parse to 0 (same as current value)
      await Simulate.change(numberInput, '')

      // onChange should not be called because the value didn't actually change
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('step functionality', () => {
    test('increments value by step on ArrowUp', async () => {
      const { node } = await render(
        <NumberEditor
          initialValue={10}
          step={5}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />,
      )
      const numberInput = getInput(node)

      await Simulate.keyDown(numberInput, Keyboard.ArrowUp, onKeyDown)
      expect(onChange).toHaveBeenCalledWith(15, '', expect.any(Object))
    })

    test('decrements value by step on ArrowDown', async () => {
      const { node } = await render(
        <NumberEditor
          initialValue={10}
          step={5}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />,
      )
      const numberInput = getInput(node)

      await Simulate.keyDown(numberInput, Keyboard.ArrowDown, onKeyDown)
      expect(onChange).toHaveBeenCalledWith(5, '', expect.any(Object))
    })

    test('handles step with decimal values', async () => {
      const { node } = await render(
        <NumberEditor
          initialValue={1.5}
          step={0.5}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />,
      )
      const numberInput = getInput(node)

      await Simulate.keyDown(numberInput, Keyboard.ArrowUp, onKeyDown)
      expect(onChange).toHaveBeenCalledWith(2, '', expect.any(Object))
    })

    test('handles step with negative values', async () => {
      const { node } = await render(
        <NumberEditor
          initialValue={-3}
          step={2}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />,
      )
      const numberInput = getInput(node)

      await Simulate.keyDown(numberInput, Keyboard.ArrowUp, onKeyDown)
      expect(onChange).toHaveBeenCalledWith(-1, '', expect.any(Object))
    })

    test('handles arrow keys with default step of 1 when step is not provided', async () => {
      const { node } = await render(<NumberEditor initialValue={10} onChange={onChange} onKeyDown={onKeyDown} />)
      const numberInput = getInput(node)

      await Simulate.keyDown(numberInput, Keyboard.ArrowUp, onKeyDown)
      expect(onChange).toHaveBeenCalledWith(11, '', expect.any(Object))
    })

    test('handles null/undefined current value with step', async () => {
      const { node } = await render(<NumberEditor step={5} onChange={onChange} onKeyDown={onKeyDown} />)
      const numberInput = getInput(node)

      await Simulate.keyDown(numberInput, Keyboard.ArrowUp, onKeyDown)
      expect(onChange).toHaveBeenCalledWith(5, '', expect.any(Object))
    })

    test('calls onKeyDown prop when arrow keys are pressed', async () => {
      const { node } = await render(<NumberEditor step={5} onChange={onChange} onKeyDown={onKeyDown} />)
      const numberInput = getInput(node)

      await Simulate.keyDown(numberInput, Keyboard.ArrowUp, onKeyDown)
      expect(onKeyDown).toHaveBeenCalled()
    })

    test('does not apply step when onKeyDown prevents default', async () => {
      const preventDefaultOnKeyDown = mock(() => false)

      const { node } = await render(
        <NumberEditor
          initialValue={10}
          step={5}
          onChange={onChange}
          onKeyDown={preventDefaultOnKeyDown}
        />,
      )
      const numberInput = getInput(node)

      await Simulate.keyDown(numberInput, Keyboard.ArrowUp, preventDefaultOnKeyDown)

      // onChange should not be called because step was not applied
      expect(onChange).not.toHaveBeenCalled()
      expect(preventDefaultOnKeyDown).toHaveBeenCalled()
    })

    test('applies step when onKeyDown does not prevent default', async () => {
      const allowDefaultOnKeyDown = mock(() => true)

      const { node } = await render(
        <NumberEditor
          initialValue={10}
          step={5}
          onChange={onChange}
          onKeyDown={allowDefaultOnKeyDown}
        />,
      )
      const numberInput = getInput(node)

      await Simulate.keyDown(numberInput, Keyboard.ArrowUp, allowDefaultOnKeyDown)

      // onChange should be called because step was applied
      expect(onChange).toHaveBeenCalledWith(15, '', expect.any(Object))
      expect(allowDefaultOnKeyDown).toHaveBeenCalled()
    })

  })

  describe('mixin integration', () => {
    test('applies Accessible mixin', async () => {
      const { node } = await render(
        <NumberEditor
          label="Test label"
          onChange={onChange}
        />,
      )
      const input = getInput(node)
      expect(input.getAttribute('aria-label')).toBe('Test label')
    })

    test('applies PrefixSuffix mixin', async () => {
      const { node } = await render(
        <NumberEditor
          prefix="Prefix"
          suffix="Suffix"
          onChange={onChange}
        />,
      )
      expect(node.textContent).toContain('Prefix')
      expect(node.textContent).toContain('Suffix')
    })

    test('applies Placeholder mixin', async () => {
      const { node } = await render(
        <NumberEditor
          placeholder="Enter a number"
          onChange={onChange}
        />,
      )
      const input = getInput(node)
      expect(input.getAttribute('placeholder')).toBe('Enter a number')
    })
  })

  describe('default props', () => {
    test('has correct default props', () => {
      expect(NumberEditor.defaultProps).toBeDefined()
    })

    test('renders with default props', async () => {
      const { node } = await render(<NumberEditor onChange={onChange} />)
      const input = getInput(node)
      expect(input).toBeTruthy()
      expect(input.type).toBe('text')
    })
  })
})
