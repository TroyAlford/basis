import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as React from 'react'
import { isNil } from '@basis/utilities'
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
      // { description: 'comma-separated input', expected: 1234, input: '1,234' },
      { description: 'single digit', expected: 5, input: '5' },
      // { description: 'multiple commas', expected: 1234567, input: '1,234,567' },
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
      const preventDefaultOnKeyDown = mock((event: React.KeyboardEvent<HTMLElement>) => {
        event.preventDefault()
        event.defaultPrevented = true
      })

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

  // TODO: we will reimplement this in a future release.
  describe.skip('number formatting in input', () => {
    test.each([
      // Invalid/Sanitizing Inputs
      { description: 'null value', input: null, output: '' },
      { description: 'undefined value', input: undefined, output: '' },
      { description: 'empty string', input: '', output: '' },
      { description: 'whitespace string', input: '  ', output: '' },
      { description: 'gross pasted string', input: '--12,34a56.78.90', output: '-123,456.7890' },
      { description: 'multiple decimals and negative signs', input: '--1234.56.78', output: '-1,234.5678' },
      // Valid Inputs
      { description: 'integer', input: 123456789.12345678, output: '123,456,789.12345678' },
      { description: 'integer', input: -123456789.12345678, output: '-123,456,789.12345678' },
      { description: 'float', input: '1234.56', output: '1,234.56' },
      { description: 'negative float', input: '-1234.56', output: '-1,234.56' },
      { description: 'integer', input: '1234', output: '1,234' },
      { description: 'negative integer', input: '-1234', output: '-1,234' },
      { description: 'empty decimal', input: '1234.', output: '1,234.' },
      { description: 'empty decimal', input: '1234.0', output: '1,234.0' },
      { description: 'empty decimal', input: '.', output: '.' },
      { description: 'empty decimal', input: '.0', output: '.0' },
    ])('formats $description', async ({ input, output }) => {
      expect(NumberEditor.formatNumber(input)).toBe(output)
      // @ts-expect-error - value is a string
      const { node } = await render(<NumberEditor value={input} />)
      expect(node.querySelector('input').value).toBe(output)
    })
  })

  // TODO: we will reimplement this in a future release.
  describe.skip('cursor management', () => {
    interface State {
      numerics: string,
      position: number,
      selected: number,
    }
    /**
     * Parses the state of the number editor into a position and range.
     * @param state - The state of the number editor.
     * @returns The position and range.
     * @example parseState('1234|5678') // { numerics: '12345678', position: 4, selected: 0 }
     * @example parseState('1234|5678|90') // { numerics: '1234567890', position: 4, selected: 2 }
     */
    function parseState(state: string): State {
      const [first, second, third] = state.split('|')
      if (isNil(third)) {
        return { numerics: `${first}${second}`, position: first.length, selected: 0 }
      } else {
        return { numerics: `${first}${second}${third}`, position: first.length, selected: second.length }
      }
    }

    // Note: this is just a test to ensure the parseState function works correctly
    test.each([
      ['1234|5678', { expected: { numerics: '12345678', position: 4, selected: 0 } }],
      ['1234|5678|90', { expected: { numerics: '1234567890', position: 4, selected: 4 } }],
    ])('parses state $title', (value, { expected }) => {
      expect(parseState(value)).toEqual(expected)
    })

    /**
     * Sets up an input with the given state.
     * @param input - The input to set up.
     * @param state - The state to set up.
     * @returns The spy on the input's setSelectionRange method.
     * @example setupInput(input, '1234|5678') // { numerics: '12345678', position: 4, selected: 0 }
     * @example setupInput(input, '1234|5678|90') // { numerics: '1234567890', position: 4, selected: 4 }
     */
    function setupInput(input: HTMLInputElement, state: string) {
      const { numerics, position, selected } = parseState(state)
      input.value = numerics
      const setSelectionRange = spyOn(input, 'setSelectionRange').mockImplementation((start, end) => {
        // Mock the selection properties by overriding the getters
        Object.defineProperty(input, 'selectionStart', { configurable: true, value: start, writable: true })
        Object.defineProperty(input, 'selectionEnd', { configurable: true, value: end, writable: true })
      })
      setSelectionRange(position, position + selected)
      return setSelectionRange
    }

    test.each([
      ['1234|5678', { numerics: '12345678', position: 4, selected: 0 }],
      ['1234|5678|90', { numerics: '1234567890', position: 4, selected: 4 }],
    ])('setupInput: %s', (value, { numerics, position, selected }) => {
      const input = document.createElement('input')
      const setSelectionRange = setupInput(input, value)
      expect(input.value).toBe(numerics)
      expect(input.selectionStart).toBe(position)
      expect(input.selectionEnd).toBe(position + selected)
      expect(setSelectionRange).toHaveBeenCalledWith(position, position + selected)
    })

    describe('getCursorPosition', () => {
      test.each([
        ['1234|5678', { prefix: '1234', selected: '', suffix: '5678' }],
        ['1234|5678|90', { prefix: '1234', selected: '5678', suffix: '90' }],
      ])('getCursorPosition: %s', (value, { prefix, selected, suffix }) => {
        const input = document.createElement('input')
        setupInput(input, value)
        expect(NumberEditor.getCursorPosition(input)).toEqual({ prefix, selected, suffix })
      })
    })

    test.each([
      ['12,3|45,678', Keyboard.Backspace, '1,2|45,678'],
      ['12,|345,678', Keyboard.Backspace, '1|,345,678'],
      ['12,345,678.1|23', Keyboard.Backspace, '12,345,678.|23'],
      ['12,345,678.|123', Keyboard.Backspace, '12,345,678|,123'],
      ['12|,345,6|78', Keyboard.Backspace, '1,2|78'],
      ['12,3|45,678', Keyboard.Delete, '1,23|5,678'],
      ['12,|345,678', Keyboard.Delete, '1,2|45,678'],
      ['12,345,678.1|23', Keyboard.Delete, '12,345,678.1|3'],
      ['12,345,678.|123', Keyboard.Delete, '12,345,678.|23'],
      ['1|.23', Keyboard.Delete, '1|23'],
      ['1.|23', Keyboard.Delete, '1.|3'],
      ['1|,234', Keyboard.Delete, '1|34'],
      ['12|,345,6|78', Keyboard.Delete, '1,2|78'],
    ])('%s -> %s -> %s', async (initial, key, expected) => {
      const initialState = parseState(initial)
      const { numerics, position, selected } = parseState(expected)
      // @ts-expect-error - value is a string
      const { node } = await render(<NumberEditor initialValue={initialState.numerics} onChange={onChange} />)
      const input = node.querySelector('input')
      const setSelectionRange = setupInput(input, initial)

      await Simulate.keyDown(input, key, onChange)

      expect(input.value).toBe(NumberEditor.formatNumber(numerics))
      expect(setSelectionRange).toHaveBeenCalledWith(position, position + selected)
    })

    test.each([
      ['1|34', '2', '1,2|34'],
      ['|1,000', '2', '2|1,000'],
      ['1,000|', '.', '1,000.|'],
      ['1,000|.00', '4', '10,004|.00'],
      ['1,000.00|', '4', '1,000.004|'],
      ['1,0|00.00', '123', '1,012,3|00.00'],
      ['1,000|.00', '12345', '100,012,345|.00'],
      ['1,000.|00', '123456', '1,000.123456|00'],
      ['1,000|.00', '$1,2.34', '100,012.34|00'],
      ['1,|000|.00', '$1,2.34', '11,234|.00'],
      ['1|,000.0|0', '8', '18|0'],
      ['1|,000.0|0', '$8.00', '18.00|0'],
    ])('%s -> %s -> %s', async (initial, key, expected) => {
      const initialState = parseState(initial)
      const { numerics, position, selected } = parseState(expected)
      // @ts-expect-error - value is a string
      const { node } = await render(<NumberEditor initialValue={initialState.numerics} onChange={onChange} />)
      const input = node.querySelector('input')
      const setSelectionRange = setupInput(input, initial)
      const { prefix, suffix } = NumberEditor.getCursorPosition(input)

      await Simulate.change(input, `${prefix}${key}${suffix}`, onChange)

      expect(input.value).toBe(NumberEditor.formatNumber(numerics))
      expect(setSelectionRange).toHaveBeenLastCalledWith(position, position + selected)
    })

    test.each([
      [123, '12a3'],
      [123, '12,3'],
      [-123.45, '--123.45'],
    ])('ignores non-numeric characters and does not call onChange', async (initial, value) => {
      const { instance } = await render<NumberEditor>(<NumberEditor initialValue={initial} onChange={onChange} />)
      // @ts-expect-error - handleInputChange is protected
      instance.handleInputChange({ target: { value } } as React.ChangeEvent<HTMLInputElement>)
      expect(onChange).not.toHaveBeenCalled()
    })
  })
})
