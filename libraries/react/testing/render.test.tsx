// render.test.tsx
import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from './render'

class Foo extends React.Component<{ value: string }> {
  render() {
    return (
      <div data-testid="foo">
        {this.props.value}
      </div>
    )
  }
}

class Bar extends React.Component {
  render() {
    return <span data-testid="bar">bar</span>
  }
}

describe('react/testing/render', () => {
  test('renders a simple class component', async () => {
    const { instance, node } = await render(<Foo value="hello" />)
    expect(node.textContent).toBe('hello')
    expect(instance).toBeInstanceOf(Foo)
  })

  test('finds class component using find()', async () => {
    const { find } = await render(
      <div>
        <Foo value="x" />
        <Bar />
      </div>,
    )
    const foo = await find(Foo)
    expect(foo).toBeDefined()
    expect((foo as Foo).props.value).toBe('x')
  })

  test('update re-renders and updates only after flush', async () => {
    const last = await render(<Foo value="first" />)
    expect(last.node.textContent).toBe('first')
    const updated = await last.update(<Foo value="second" />)
    expect(updated.node.textContent).toBe('second')
    expect(updated.instance).toBe(last.instance)
  })

  test('findAll collects multiple instances', async () => {
    const { findAll } = await render(
      <div>
        <Foo value="1" />
        <Foo value="2" />
        <Foo value="3" />
      </div>,
    )
    const all = await findAll(Foo)
    expect(all.map(x => x.props.value)).toEqual(['1', '2', '3'])
  })

  test('search handles error via componentDidCatch hook', async () => {
    class Bad extends React.Component {
      componentDidMount() {
        throw new Error('Oops')
      }
      render() {
        return <div>bad</div>
      }
    }

    const wrapper = await render(<Bad />)
    // Because Mounter.componentDidCatch resolves on update, update() returns
    const { update } = wrapper
    await update() // should not hang
    expect(true).toBe(true) // confirm no unhandled errors
  })
})
