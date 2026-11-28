import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { Component } from './Component'

type Tag = keyof React.JSX.IntrinsicElements

class TestComponent extends Component<{ tag?: Tag }> {
  static displayName = null
  get classNames() { return super.classNames.add(' foo bar baz ') }
  get tag(): Tag { return this.props.tag ?? 'div' }
  content(children) { return children ?? 'content' }
}

describe('Component', () => {
  test('renders the specified tag', async () => {
    const div = await render(<TestComponent />)
    expect(div.node.tagName).toBe('DIV')

    const span = await render(<TestComponent tag="span" />)
    expect(span.node.tagName).toBe('SPAN')
  })

  test('nodeRef', async () => {
    const ref = React.createRef<HTMLDivElement>()
    const { node } = await render(<TestComponent nodeRef={ref} />)
    expect(ref.current).toBe(node as HTMLDivElement)
  })

  describe('classNames', () => {
    test('from the classNames getter', async () => {
      const { node } = await render(<TestComponent />)
      expect(node).toHaveClass('foo', 'bar', 'baz')
    })

    test('from the component name', async () => {
      const testComponent = await render(<TestComponent />)
      expect(testComponent.node).toHaveClass('test-component')

      TestComponent.displayName = 'Qux'
      const qux = await render(<TestComponent />)
      expect(qux.node).toHaveClass('qux')
      expect(qux.node).not.toHaveClass('test-component')
    })

    test('from the className prop', async () => {
      const { node } = await render(<TestComponent className="qux" />)
      expect(node).toHaveClass('qux')
    })
  })

  test('data-* props', async () => {
    const { node } = await render(<TestComponent data-foo data-bar={42} data-baz="qux" />)
    expect(node).toHaveAttribute('data-foo', 'true')
    expect(node).toHaveAttribute('data-bar', '42')
    expect(node).toHaveAttribute('data-baz', 'qux')
  })

  test('aria-* props', async () => {
    const { node } = await render(
      <TestComponent
        aria-controls="menu-1"
        aria-expanded="true"
        aria-haspopup="true"
      />,
    )
    expect(node).toHaveAttribute('aria-expanded', 'true')
    expect(node).toHaveAttribute('aria-haspopup', 'true')
    expect(node).toHaveAttribute('aria-controls', 'menu-1')
  })

  describe('rendering optimization', () => {
    test('does not re-render when props are deeply equal', async () => {
      const renderMock = mock(() => null)

      class RenderTestComponent extends Component<object> {
        render = renderMock
      }

      const { update } = await render(<RenderTestComponent data-foo={{ bar: 'baz' }} />)

      // Update with deeply equal props
      update(<RenderTestComponent data-foo={{ bar: 'baz' }} />)

      expect(renderMock).toHaveBeenCalledTimes(1)
    })

    test('re-renders when props change', async () => {
      const renderMock = mock(() => null)

      class RenderTestComponent extends Component<object> {
        render = renderMock
      }

      const { update } = await render(
        <RenderTestComponent aria-expanded="true" data-foo="true" />,
      )

      // Update with different props
      await update(<RenderTestComponent aria-expanded="false" data-foo="true" />)

      expect(renderMock).toHaveBeenCalledTimes(2)
    })

    test('re-renders when state changes', async () => {
      const renderMock = mock(() => null)

      class RenderTestComponent extends Component<object, HTMLDivElement, { count: number }> {
        state = { count: 0 }
        render = renderMock
      }

      const { instance } = await render(<RenderTestComponent />)
      await instance.setState({ count: 1 })

      expect(renderMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('renders content', () => {
    test('from the content getter', async () => {
      const { node } = await render(<TestComponent />)
      expect(node.textContent).toBe('content')
    })

    test('from the children prop', async () => {
      const { node } = await render(<TestComponent>children</TestComponent>)
      expect(node.textContent).toBe('children')
    })
  })

  describe('native props', () => {
    test('forwards standard native attributes and events to the root element', async () => {
      const onFocus = mock()
      const onKeyDown = mock()
      const { node } = await render(
        <TestComponent
          id="thing"
          role="region"
          tabIndex={3}
          title="A thing"
          onFocus={onFocus}
          onKeyDown={onKeyDown}
        />,
      )

      expect(node).toHaveAttribute('id', 'thing')
      expect(node).toHaveAttribute('role', 'region')
      expect(node).toHaveAttribute('tabindex', '3')
      expect(node).toHaveAttribute('title', 'A thing')

      node.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      expect(onFocus).toHaveBeenCalledTimes(1)

      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }))
      expect(onKeyDown).toHaveBeenCalledTimes(1)
    })

    test('removes an owned onClick by overriding attributes', async () => {
      class ClickComponent extends Component<{ onClick?: () => void }> {
        static displayName = 'ClickComponent'
        get attributes() {
          const attributes = { ...super.attributes } as Record<string, unknown>
          delete attributes.onClick
          return attributes
        }
        get tag(): Tag { return 'button' }
      }
      const onClick = mock()
      const { node } = await render(<ClickComponent onClick={onClick} />)

      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

      expect(onClick).not.toHaveBeenCalled()
    })

    test('removes an owned onChange by overriding attributes', async () => {
      class ChangeComponent extends Component<{ onChange?: () => void }> {
        static displayName = 'ChangeComponent'
        get attributes() {
          const attributes = { ...super.attributes } as Record<string, unknown>
          delete attributes.onChange
          return attributes
        }
        get tag(): Tag { return 'input' }
      }
      const onChange = mock()
      const { node } = await render(<ChangeComponent onChange={onChange} />)

      await Simulate.change(node as HTMLInputElement, 'changed')

      expect(onChange).not.toHaveBeenCalled()
    })

    test('allows a component to forward onClick explicitly', async () => {
      class ExplicitClickComponent extends Component<{ onClick?: () => void }> {
        static displayName = 'ExplicitClickComponent'
        get attributes() { return { ...super.attributes, onClick: this.props.onClick } }
        get tag(): Tag { return 'button' }
      }
      const onClick = mock()
      const { node } = await render(<ExplicitClickComponent onClick={onClick} />)

      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    test('allows a component to forward onChange explicitly', async () => {
      class ExplicitChangeComponent extends Component<{ onChange?: () => void }> {
        static displayName = 'ExplicitChangeComponent'
        get attributes() { return { ...super.attributes, onChange: this.props.onChange } }
        get tag(): Tag { return 'input' }
      }
      const onChange = mock()
      const { node } = await render(<ExplicitChangeComponent onChange={onChange} />)

      await Simulate.change(node as HTMLInputElement, 'changed')

      expect(onChange).toHaveBeenCalledTimes(1)
    })

    test('does not forward component-specific props', async () => {
      class OwnedComponent extends Component<{ orientation?: string }> {
        static displayName = 'OwnedComponent'
      }

      const { node } = await render(<OwnedComponent orientation="vertical" />)

      expect(node.hasAttribute('orientation')).toBe(false)
    })

    test('inherits an attributes override', async () => {
      class OwnedComponent extends Component<{ title?: React.ReactNode }> {
        static displayName = 'OwnedComponent'
        get attributes() {
          const attributes = { ...super.attributes } as Record<string, unknown>
          delete attributes.title
          return attributes
        }
      }
      class SubComponent extends OwnedComponent {
        static displayName = 'SubComponent'
      }

      const { node } = await render(<SubComponent title="owned" />)
      expect(node.hasAttribute('title')).toBe(false)
    })
  })
})
