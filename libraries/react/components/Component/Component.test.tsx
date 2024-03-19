import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Component } from './Component'

class TestComponent extends Component<{ tag?: string }> {
	static displayName = null
	get classNames() { return ' foo bar baz ' }
	get content() { return this.props.children ?? 'content' }
	get tag() { return this.props.tag ?? 'div' }
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
		test('from the data prop', () => {
			const { node } = render(<TestComponent data={{ bar: 42, baz: 'qux', foo: true }} />)
			expect(node).toHaveAttribute('data-foo', 'true')
			expect(node).toHaveAttribute('data-bar', '42')
			expect(node).toHaveAttribute('data-baz', 'qux')
		})

		test('from data-* attributes', () => {
			const foo = render(<TestComponent data-foo />)
			expect(foo.node).toHaveAttribute('data-foo', 'true')

			const bar = render(<TestComponent data-bar={42} />)
			expect(bar.node).toHaveAttribute('data-bar', '42')
		})

		test('data attributes override matching data-* attributes', () => {
			const { node } = render(<TestComponent data-foo data={{ foo: false }} />)
			expect(node).toHaveAttribute('data-foo', 'false')
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