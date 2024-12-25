import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Editor } from './Editor'

class TestEditor extends Editor<string> {
  public testHandleChange(value: string): void {
    this.handleChange(value)
  }

  get data(): Record<string, unknown> {
    return {
      ...super.data,
      value: this.current,
    }
  }

  content(): React.ReactNode {
    return this.current
  }
}

describe('Editor', () => {
  describe('initialization', () => {
    test('renders with default props', () => {
      const { node } = render(<TestEditor />)
      expect(node).toHaveClass('editor')
      expect(node.dataset.value).toBeUndefined()
    })

    test('renders with initial value', () => {
      const { node } = render(<TestEditor initialValue="test" />)
      expect(node.dataset.value).toBe('test')
      expect(node.textContent).toBe('test')
    })

    test('renders with controlled value', () => {
      const { node } = render(<TestEditor value="controlled" />)
      expect(node.dataset.value).toBe('controlled')
      expect(node.textContent).toBe('controlled')
    })

    test('renders with field identifier', () => {
      const { node: numberNode } = render(<TestEditor field={1} />)
      expect(numberNode).toHaveClass('editor', 'index-1')

      const { node: stringNode } = render(<TestEditor field="test-field" />)
      expect(stringNode).toHaveClass('editor', 'test-field')
    })

    test('renders with read-only state', () => {
      const { node } = render(<TestEditor readOnly />)
      expect(node).toHaveAttribute('readOnly')
      expect(node).toHaveAttribute('aria-readonly', 'true')
    })
  })

  describe('value management', () => {
    test('handles controlled mode updates', () => {
      const onChange = mock((value: string) => value)
      const { update } = render(
        <TestEditor
          value="initial"
          onChange={onChange}
        />,
      )

      update(<TestEditor value="updated" onChange={onChange} />)
      expect(onChange).not.toHaveBeenCalled()
    })

    test('handles uncontrolled mode updates', () => {
      const onChange = mock((value: string) => value)
      const { instance } = render<TestEditor>(
        <TestEditor
          initialValue="initial"
          onChange={onChange}
        />,
      )

      instance.testHandleChange('updated')
      expect(onChange).toHaveBeenCalledWith('updated', '', instance)
      expect(instance.current).toBe('updated')
    })

    test('handles field updates', () => {
      const onChange = mock((value: string) => value)
      const { instance } = render<TestEditor>(
        <TestEditor
          field="test-field"
          initialValue="initial"
          onChange={onChange}
        />,
      )

      instance.testHandleChange('updated')
      expect(onChange).toHaveBeenCalledWith('updated', 'test-field', instance)
    })
  })

  describe('nested field handling', () => {
    interface NestedValue {
      a: {
        b: {
          c: string,
        },
      },
    }

    class NestedEditor extends Editor<NestedValue> {
      public testHandleField(value: unknown, path: string): void {
        this.handleField(value, path)
      }

      renderEditor(): React.ReactNode {
        return <div data-value={JSON.stringify(this.current)} />
      }
    }

    test('handles nested field updates', () => {
      const initialValue = {
        a: {
          b: {
            c: 'initial',
          },
        },
      }

      const { instance } = render<NestedEditor>(
        <NestedEditor initialValue={initialValue} />,
      )

      instance.testHandleField('updated', 'a.b.c')
      expect(instance.current).toEqual({
        a: {
          b: {
            c: 'updated',
          },
        },
      })
    })

    test('safely handles invalid paths', () => {
      const initialValue = {
        a: {
          b: {
            c: 'initial',
          },
        },
      }

      const { instance } = render<NestedEditor>(
        <NestedEditor initialValue={initialValue} />,
      )

      instance.testHandleField('updated', '')
      expect(instance.current).toEqual(initialValue)
    })
  })

  describe('type checking', () => {
    test('identifies Editor components', () => {
      expect(Editor.isEditor(Editor)).toBe(true)
      expect(Editor.isEditor(TestEditor)).toBe(true)
      // eslint-disable-next-line @typescript-eslint/no-extraneous-class
      expect(Editor.isEditor(class EmptyClass { })).toBe(false)
      expect(Editor.isEditor({})).toBe(false)
    })
  })
})
