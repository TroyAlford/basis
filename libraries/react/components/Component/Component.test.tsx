import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Component } from './Component'

class TestComponent extends Component<{ tag?: keyof React.ReactHTML }> {
  static displayName = null
  get classNames() { return super.classNames.add(' foo bar baz ') }
  get tag(): keyof React.ReactHTML { return this.props.tag ?? 'div' }
  content(children) { return children ?? 'content' }
}

describe('Component', () => {
  test('renders the specified tag', () => {
    const div = render(<TestComponent />)
    expect(div.node.tagName).toBe('DIV')

    const span = render(<TestComponent tag="span" />)
    expect(span.node.tagName).toBe('SPAN')
  })

  test('nodeRef', () => {
    const ref = React.createRef<HTMLDivElement>()
    const { node } = render(<TestComponent nodeRef={ref} />)
    expect(ref.current).toBe(node as HTMLDivElement)
  })

  describe('classNames', () => {
    test('from the classNames getter', () => {
      const { node } = render(<TestComponent />)
      expect(node).toHaveClass('foo', 'bar', 'baz')
    })

    test('from the component name', () => {
      const testComponent = render(<TestComponent />)
      expect(testComponent.node).toHaveClass('test-component')

      TestComponent.displayName = 'Qux'
      const qux = render(<TestComponent />)
      expect(qux.node).toHaveClass('qux')
      expect(qux.node).not.toHaveClass('test-component')
    })

    test('from the className prop', () => {
      const { node } = render(<TestComponent className="qux" />)
      expect(node).toHaveClass('qux')
    })
  })

  describe('data attributes', () => {
    test('from direct data-* props', () => {
      const { node } = render(<TestComponent data-foo data-bar={42} data-baz="qux" />)
      expect(node).toHaveAttribute('data-foo', 'true')
      expect(node).toHaveAttribute('data-bar', '42')
      expect(node).toHaveAttribute('data-baz', 'qux')
    })

    test('from data object prop', () => {
      const { node } = render(<TestComponent data={{ bar: 42, baz: 'qux', foo: true }} />)
      expect(node).toHaveAttribute('data-foo', 'true')
      expect(node).toHaveAttribute('data-bar', '42')
      expect(node).toHaveAttribute('data-baz', 'qux')
    })

    test('direct data-* props take precedence over data object', () => {
      const { node } = render(
        <TestComponent
          data-foo
          data={{ bar: 0, foo: false }}
          data-bar={42}
        />,
      )
      expect(node).toHaveAttribute('data-foo', 'true')
      expect(node).toHaveAttribute('data-bar', '42')
    })
  })

  describe('ARIA attributes', () => {
    test('from direct aria-* props', () => {
      const { node } = render(
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

    test('from aria object prop', () => {
      const { node } = render(
        <TestComponent
          aria={{
            controls: 'menu-1',
            expanded: true,
            haspopup: true,
          }}
        />,
      )
      expect(node).toHaveAttribute('aria-expanded', 'true')
      expect(node).toHaveAttribute('aria-haspopup', 'true')
      expect(node).toHaveAttribute('aria-controls', 'menu-1')
    })

    test('direct aria-* props take precedence over aria object', () => {
      const { node } = render(
        <TestComponent
          aria-expanded="false"
          aria-haspopup="true"
          aria={{
            controls: 'menu-1',
            expanded: true,
          }}
        />,
      )
      expect(node).toHaveAttribute('aria-expanded', 'false')
      expect(node).toHaveAttribute('aria-haspopup', 'true')
      expect(node).toHaveAttribute('aria-controls', 'menu-1')
    })
  })

  describe('rendering optimization', () => {
    test('does not re-render when props are deeply equal', () => {
      const renderMock = mock(() => null)

      class RenderTestComponent extends Component<object> {
        render = renderMock
      }

      const { update } = render(
        <RenderTestComponent
          aria={{ expanded: true }}
          data={{ foo: true }}
        />,
      )

      // Update with deeply equal props
      update(
        <RenderTestComponent
          aria={{ expanded: true }}
          data={{ foo: true }}
        />,
      )

      expect(renderMock).toHaveBeenCalledTimes(1)
    })

    test('re-renders when props change', () => {
      const renderMock = mock(() => null)

      class RenderTestComponent extends Component<object> {
        render = renderMock
      }

      const { update } = render(
        <RenderTestComponent
          aria={{ expanded: true }}
          data={{ foo: true }}
        />,
      )

      // Update with different props
      update(
        <RenderTestComponent
          aria={{ expanded: false }}
          data={{ foo: true }}
        />,
      )

      expect(renderMock).toHaveBeenCalledTimes(2)
    })

    test('re-renders when state changes', () => {
      const renderMock = mock(() => null)

      class RenderTestComponent extends Component<object, HTMLDivElement, { count: number }> {
        state = { count: 0 }
        render = renderMock
      }

      const { instance } = render(<RenderTestComponent />)
      instance.setState({ count: 1 })

      expect(renderMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('renders content', () => {
    test('from the content getter', () => {
      const { node } = render(<TestComponent />)
      expect(node.textContent).toBe('content')
    })

    test('from the children prop', () => {
      const { node } = render(<TestComponent>children</TestComponent>)
      expect(node.textContent).toBe('children')
    })
  })
})
