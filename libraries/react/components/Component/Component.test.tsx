import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
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

  describe('data attributes', () => {
    test('from direct data-* props', async () => {
      const { node } = await render(<TestComponent data-foo data-bar={42} data-baz="qux" />)
      expect(node).toHaveAttribute('data-foo', 'true')
      expect(node).toHaveAttribute('data-bar', '42')
      expect(node).toHaveAttribute('data-baz', 'qux')
    })

    test('from data object prop', async () => {
      const { node } = await render(<TestComponent data={{ bar: 42, baz: 'qux', foo: true }} />)
      expect(node).toHaveAttribute('data-foo', 'true')
      expect(node).toHaveAttribute('data-bar', '42')
      expect(node).toHaveAttribute('data-baz', 'qux')
    })

    test('direct data-* props take precedence over data object', async () => {
      const { node } = await render(
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
    test('from direct aria-* props', async () => {
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

    test('from aria object prop', async () => {
      const { node } = await render(
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

    test('direct aria-* props take precedence over aria object', async () => {
      const { node } = await render(
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
    test('does not re-render when props are deeply equal', async () => {
      const renderMock = mock(() => null)

      class RenderTestComponent extends Component<object> {
        render = renderMock
      }

      const { update } = await render(
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

    test('re-renders when props change', async () => {
      const renderMock = mock(() => null)

      class RenderTestComponent extends Component<object> {
        render = renderMock
      }

      const { update } = await render(
        <RenderTestComponent
          aria={{ expanded: true }}
          data={{ foo: true }}
        />,
      )

      // Update with different props
      await update(
        <RenderTestComponent
          aria={{ expanded: false }}
          data={{ foo: true }}
        />,
      )

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
})
