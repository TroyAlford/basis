import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Component } from './Component'

class TestComponent extends Component {
	get classNames() { return ' foo bar baz ' }
	get content() { return this.props.children ?? 'content' }
}

describe('Component', () => {
	test('renders a div by default', () => {
		const { node } = render(<TestComponent />)
		expect(node.tagName).toBe('DIV')
	})

	describe('renders classNames', () => {
		test('from the classNames getter', () => {
			const { node } = render(<TestComponent />)
			expect(node.matches('.foo.bar.baz')).toBeTrue()
		})

		test('from the component name', () => {
			const { node } = render(<TestComponent />)
			expect(node.matches('.test-component')).toBeTrue()
		})

		test('from the className prop', () => {
			const { node } = render(<TestComponent className="qux" />)
			expect(node.matches('.qux')).toBeTrue()
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