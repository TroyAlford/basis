import { beforeEach, describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { TextEditor } from './TextEditor'

describe('TextEditor', () => {
  const getInput = (node: Element) => node.querySelector('input') as HTMLInputElement
  const getTextarea = (node: Element) => node.querySelector('textarea') as HTMLTextAreaElement

  // Shared mocks
  let onChange: ReturnType<typeof mock>
  let onKeyDown: ReturnType<typeof mock>

  beforeEach(() => {
    onChange = mock()
    onKeyDown = mock()
  })

  describe('element rendering', () => {
    test.each([
      { expectedElement: 'input', multiline: false },
      { expectedElement: 'textarea', multiline: true },
    ])('renders $expectedElement when multiline is $multiline', async ({ expectedElement, multiline }) => {
      const { node } = await render(<TextEditor multiline={multiline} onChange={onChange} />)

      if (expectedElement === 'input') {
        const input = getInput(node)
        expect(input).toBeTruthy()
        expect(input.type).toBe('text')
      } else {
        const textarea = getTextarea(node)
        expect(textarea).toBeTruthy()
      }
    })
  })

  describe('autoComplete behavior', () => {
    test.each([
      { autoComplete: true, expected: 'on' },
      { autoComplete: false, expected: 'off' },
    ])('sets autocomplete to $expected when autoComplete is $autoComplete', async ({ autoComplete, expected }) => {
      const { node } = await render(<TextEditor autoComplete={autoComplete} onChange={onChange} />)
      const input = getInput(node)
      expect(input.getAttribute('autocomplete')).toBe(expected)
    })

    test.each([
      { autoComplete: true, expected: 'on' },
      { autoComplete: false, expected: 'off' },
    ])(
      'sets textarea autocomplete to $expected when autoComplete is $autoComplete',
      async ({ autoComplete, expected }) => {
        const { node } = await render(<TextEditor multiline autoComplete={autoComplete} onChange={onChange} />)
        const textarea = getTextarea(node)
        expect(textarea.getAttribute('autocomplete')).toBe(expected)
      },
    )
  })

  describe('value changes', () => {
    test('handles input value changes', async () => {
      const { node } = await render(<TextEditor initialValue="initial" onChange={onChange} />)
      const input = getInput(node)
      await expect(Simulate.change(input, 'new value')).toRaise(onChange, 'new value')
    })

    test('handles textarea value changes', async () => {
      const { node } = await render(<TextEditor multiline value="initial" onChange={onChange} />)
      const textarea = getTextarea(node)
      await expect(Simulate.change(textarea, 'new multiline value')).toRaise(onChange, 'new multiline value')
    })

    test('handles special characters in multiline mode', async () => {
      const specialText = 'Line 1\n\tTabbed line\nLine 3'
      const { node } = await render(<TextEditor multiline onChange={onChange} />)
      const textarea = getTextarea(node)
      await expect(Simulate.change(textarea, specialText)).toRaise(onChange, specialText)
    })

    test('does not call onChange when value does not change', async () => {
      const { node } = await render(<TextEditor initialValue="test" onChange={onChange} />)
      const input = getInput(node)

      // Change to the same value
      await Simulate.change(input, 'test')

      // onChange should not be called because the value didn't actually change
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('onKeyDown callback', () => {
    test('calls onKeyDown for input', async () => {
      const { node } = await render(<TextEditor onChange={onChange} onKeyDown={onKeyDown} />)
      const input = getInput(node)
      await Simulate.keyDown(input, 'Enter', onKeyDown)
      expect(onKeyDown).toHaveBeenCalled()
    })

    test('calls onKeyDown for textarea', async () => {
      const { node } = await render(<TextEditor multiline onChange={onChange} onKeyDown={onKeyDown} />)
      const textarea = getTextarea(node)
      await Simulate.keyDown(textarea, 'Enter', onKeyDown)
      expect(onKeyDown).toHaveBeenCalled()
    })
  })

  describe('textarea-specific features', () => {
    describe('resizable behavior', () => {
      test.each([
        { expectedStyle: '', resizable: true },
        { expectedStyle: 'none', resizable: false },
      ])('sets resize style to $expectedStyle when resizable is $resizable', async ({ expectedStyle, resizable }) => {
        const { node } = await render(<TextEditor multiline resizable={resizable} onChange={onChange} />)
        const textarea = getTextarea(node)
        expect(textarea.style.resize).toBe(expectedStyle)
      })
    })

    describe('wrap behavior', () => {
      test.each([
        { expected: 'soft', wrap: TextEditor.Wrap.Soft },
        { expected: 'hard', wrap: TextEditor.Wrap.Hard },
        { expected: 'off', wrap: TextEditor.Wrap.Off },
      ])('sets wrap to $expected when wrap is $wrap', async ({ expected, wrap }) => {
        const { node } = await render(<TextEditor multiline wrap={wrap} onChange={onChange} />)
        const textarea = getTextarea(node)
        expect(textarea.getAttribute('wrap')).toBe(expected)
      })
    })
  })

  describe('readOnly behavior', () => {
    test('renders text instead of input when readOnly is true', async () => {
      const { node } = await render(<TextEditor readOnly value="Read-only text" onChange={onChange} />)
      const input = node.querySelector('input')
      expect(input).toBeNull()
      expect(node.textContent).toBe('Read-only text')
    })

    test('renders text instead of textarea when readOnly is true', async () => {
      const { node } = await render(
        <TextEditor
          multiline
          readOnly
          value="Read-only text"
          onChange={onChange}
        />,
      )
      const textarea = node.querySelector('textarea')
      expect(textarea).toBeNull()
      expect(node.textContent).toBe('Read-only text')
    })

    describe('multiline readOnly with line breaks', () => {
      test('converts newlines to <br /> tags in readOnly mode', async () => {
        const value = 'Line 1\nLine 2\nLine 3'
        const { node } = await render(
          <TextEditor
            multiline
            readOnly
            value={value}
            onChange={onChange}
          />,
        )

        const textarea = node.querySelector('textarea')
        expect(textarea).toBeNull()

        const brElements = node.querySelectorAll('br')
        expect(brElements).toHaveLength(2) // 3 lines = 2 br elements
      })

      test('handles empty multiline text in readOnly mode', async () => {
        const { node } = await render(
          <TextEditor
            multiline
            readOnly
            value=""
            onChange={onChange}
          />,
        )

        const textarea = node.querySelector('textarea')
        expect(textarea).toBeNull()
        expect(node.textContent).toBe('')
      })

      test('handles single line multiline text in readOnly mode', async () => {
        const { node } = await render(
          <TextEditor
            multiline
            readOnly
            value="Single line"
            onChange={onChange}
          />,
        )

        const textarea = node.querySelector('textarea')
        expect(textarea).toBeNull()
        expect(node.textContent).toBe('Single line')

        const brElements = node.querySelectorAll('br')
        expect(brElements).toHaveLength(0) // No line breaks = no br elements
      })

      test('handles null/undefined values in readOnly mode', async () => {
        const { node } = await render(
          <TextEditor
            readOnly
            value={null as unknown as string}
            onChange={onChange}
          />,
        )

        const input = node.querySelector('input')
        expect(input).toBeNull()
        expect(node.textContent).toBe('')
      })
    })
  })

  describe('mixin integration', () => {
    test('applies Accessible mixin to input', async () => {
      const { node } = await render(
        <TextEditor
          label="Test label"
          onChange={onChange}
        />,
      )
      const input = getInput(node)
      expect(input.getAttribute('aria-label')).toBe('Test label')
    })

    test('applies Accessible mixin to textarea', async () => {
      const { node } = await render(
        <TextEditor
          multiline
          label="Test label"
          onChange={onChange}
        />,
      )
      const textarea = getTextarea(node)
      expect(textarea.getAttribute('aria-label')).toBe('Test label')
    })

    test('applies PrefixSuffix mixin to input', async () => {
      const { node } = await render(
        <TextEditor
          prefix="Prefix"
          suffix="Suffix"
          onChange={onChange}
        />,
      )
      expect(node.textContent).toContain('Prefix')
      expect(node.textContent).toContain('Suffix')
    })

    test('applies PrefixSuffix mixin to textarea', async () => {
      const { node } = await render(
        <TextEditor
          multiline
          prefix="Prefix"
          suffix="Suffix"
          onChange={onChange}
        />,
      )
      expect(node.textContent).toContain('Prefix')
      expect(node.textContent).toContain('Suffix')
    })

    test('applies Placeholder mixin to input', async () => {
      const { node } = await render(
        <TextEditor
          placeholder="Test placeholder"
          onChange={onChange}
        />,
      )
      const input = getInput(node)
      expect(input.getAttribute('placeholder')).toBe('Test placeholder')
    })

    test('applies Placeholder mixin to textarea', async () => {
      const { node } = await render(
        <TextEditor
          multiline
          placeholder="Test placeholder"
          onChange={onChange}
        />,
      )
      const textarea = getTextarea(node)
      expect(textarea.getAttribute('placeholder')).toBe('Test placeholder')
    })
  })

  describe('default props', () => {
    test('has correct default props', () => {
      expect(TextEditor.defaultProps.resizable).toBe(true)
      expect(TextEditor.defaultProps.wrap).toBe(TextEditor.Wrap.Soft)
    })

    test('renders textarea with default props', async () => {
      const { node } = await render(<TextEditor multiline onChange={onChange} />)
      const textarea = getTextarea(node)
      expect(textarea.style.resize).toBe('') // resizable: true
      expect(textarea.getAttribute('wrap')).toBe('soft')
    })
  })
})
