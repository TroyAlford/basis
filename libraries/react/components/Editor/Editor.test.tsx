import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Editor } from './Editor'

class TestEditor extends Editor<string> {
  public async testHandleChange(value: string): Promise<void> {
    await this.handleChange(value)
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
    test('renders with default props', async () => {
      const { node } = await render(<TestEditor />)
      expect(node).toHaveClass('editor')
      expect(node.dataset.value).toBeUndefined()
    })

    test('renders with initial value', async () => {
      const { node } = await render(<TestEditor initialValue="test" />)
      expect(node.dataset.value).toBe('test')
      expect(node.textContent).toBe('test')
    })

    test('renders with controlled value', async () => {
      const { node } = await render(<TestEditor value="controlled" />)
      expect(node.dataset.value).toBe('controlled')
      expect(node.textContent).toBe('controlled')
    })

    test('renders with field identifier', async () => {
      const { node: numberNode } = await render(<TestEditor field="1" />)
      expect(numberNode).toHaveClass('editor', '1')
      expect(numberNode).toHaveAttribute('data-field', '1')

      const { node: stringNode } = await render(<TestEditor field="test-field" />)
      expect(stringNode).toHaveClass('editor', 'test-field')
      expect(stringNode).toHaveAttribute('data-field', 'test-field')
    })

    test('renders without data-field when field is not provided', async () => {
      const { node } = await render(<TestEditor />)
      expect(node).not.toHaveAttribute('data-field')
    })

    test('renders with read-only state', async () => {
      const { node } = await render(<TestEditor readOnly />)
      expect(node).toHaveAttribute('readOnly')
      expect(node).toHaveAttribute('aria-readonly', 'true')
    })

    test('renders without readOnly attribute when not read-only', async () => {
      const { node } = await render(<TestEditor />)
      expect(node).not.toHaveAttribute('readOnly')
      expect(node).toHaveAttribute('aria-readonly', 'false')
    })
  })

  describe('value management', () => {
    test('handles controlled mode updates', async () => {
      const onChange = mock((value: string) => value)
      const { update } = await render(
        <TestEditor
          value="initial"
          onChange={onChange}
        />,
      )

      await update(<TestEditor value="updated" onChange={onChange} />)
      expect(onChange).not.toHaveBeenCalled()
    })

    test('handles uncontrolled mode updates', async () => {
      const onChange = mock((value: string) => value)
      const { instance } = await render<TestEditor>(
        <TestEditor
          initialValue="initial"
          onChange={onChange}
        />,
      )

      await instance.testHandleChange('updated')
      expect(onChange).toHaveBeenCalledWith('updated', '', instance)
      expect(instance.current).toBe('updated')
    })

    test('handles field updates', async () => {
      const onChange = mock((value: string) => value)
      const { instance } = await render<TestEditor>(
        <TestEditor
          field="test-field"
          initialValue="initial"
          onChange={onChange}
        />,
      )

      await instance.testHandleChange('updated')
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
      public async testHandleField(value: unknown, path: string): Promise<void> {
        await this.handleField(value, path)
      }

      renderEditor(): React.ReactNode {
        return <div data-value={JSON.stringify(this.current)} />
      }
    }

    test('handles nested field updates', async () => {
      const initialValue = {
        a: {
          b: {
            c: 'initial',
          },
        },
      }

      const { instance } = await render<NestedEditor>(
        <NestedEditor initialValue={initialValue} />,
      )

      await instance.testHandleField('updated', 'a.b.c')
      expect(instance.current).toEqual({
        a: {
          b: {
            c: 'updated',
          },
        },
      })
    })

    test('safely handles invalid paths', async () => {
      const initialValue = {
        a: {
          b: {
            c: 'initial',
          },
        },
      }

      const { instance } = await render<NestedEditor>(
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
