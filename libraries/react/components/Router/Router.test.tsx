import { beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Router } from './Router'

const TestComponent = () => <span>Test!</span>

describe('Router', () => {
	const formatURL = (url: string) => `http://example.com/${url}`
	const location = spyOn(window.location, 'toString')

	beforeEach(() => {
		location.mockClear()
	})

	describe('matches routes', () => {
		test.each([
			['pages/foo', { slug: 'foo' }],
			['pages/bar', { slug: 'bar' }],
			['foo/123', { id: '123', type: 'foo' }],
			['bar/456', { id: '456', type: 'bar' }],
			['error/404', { code: '404' }],
			['error/500', { code: '500' }],
		])('and passes templated params as props', (url, props) => {
			location.mockReturnValue(formatURL(url))
			const { find } = render<Router>(
				<Router>
					<Router.Route component={<TestComponent />} template="/pages/:slug" />
					<Router.Route component={<TestComponent />} template="/error/:code" />
					<Router.Route component={<TestComponent />} template="/:type/:id" />
				</Router>
			)
			const component = find(TestComponent)
			expect(component.props).toEqual(props)
		})

		test('renders a new route when the path changes', () => {
			location.mockReturnValue(formatURL('foo/123'))
			const { find, instance, update } = render<Router>(
				<Router>
					<Router.Route component={TestComponent} template="/foo/:id" />
					<Router.Route component={TestComponent} template="/bar/:id" />
				</Router>
			)
			expect(find(TestComponent).props).toEqual({ id: '123' })

			location.mockReturnValue(formatURL('bar/234'))
			instance.setState({ currentURL: instance.currentURL })
			update()
			expect(find(TestComponent).props).toEqual({ id: '234' })
		})

		test('includes query params in the props', () => {
			location.mockReturnValue(formatURL('foo/123?bar=baz'))
			const { find, instance, update } = render<Router>(
				<Router>
					<Router.Route component={TestComponent} template="/foo/:id" />
				</Router>
			)
			expect(find(TestComponent).props).toEqual({ bar: 'baz', id: '123' })

			location.mockReturnValue(formatURL('foo/123?bar=baz&qux=quux'))
			instance.setState({ currentURL: instance.currentURL })
			update()
			expect(find(TestComponent).props).toEqual({ bar: 'baz', id: '123', qux: 'quux' })
		})
	})

	test.each([
		['props.component', { component: TestComponent }],
		['props.component', { component: <TestComponent /> }],
		['props.render', { render: props => <TestComponent {...props} /> }],
	])('%s renders with props', (_, props) => {
		location.mockReturnValue(formatURL('foo/123?bar=baz'))
		const { find, instance, update } = render<Router>(
			<Router>
				<Router.Route {...props} template="/:type/:id" />
			</Router>
		)
		const component = find(TestComponent)
		expect(component.props).toEqual({ bar: 'baz', id: '123', type: 'foo' })

		location.mockReturnValue(formatURL('bar/234?baz=qux'))
		instance.setState({ currentURL: instance.currentURL })
		update()
		expect(find(TestComponent).props).toEqual({ baz: 'qux', id: '234', type: 'bar' })
	})

	test('renders null when no route matches', () => {
		location.mockReturnValue(formatURL('baz/123'))
		const { find, instance, update } = render<Router>(
			<Router>
				<Router.Route component={TestComponent} template="/foo/:id" />
				<Router.Route component={TestComponent} template="/bar/:id" />
			</Router>
		)
		expect(find(TestComponent)).toBeNull()

		location.mockReturnValue(formatURL('foo/123'))
		instance.setState({ currentURL: instance.currentURL })
		update()
		expect(find(TestComponent)).not.toBeNull()

		location.mockReturnValue(formatURL('baz/123'))
		instance.setState({ currentURL: instance.currentURL })
		update()
		expect(find(TestComponent)).toBeNull()
	})

	test('responds to popstate events', () => {
		location.mockReturnValue(formatURL('foo/123'))
		const { instance } = render<Router>(
			<Router>
				<Router.Route component={TestComponent} template="/foo/:id" />
				<Router.Route component={TestComponent} template="/bar/:id" />
			</Router>
		)
		expect(instance.state.currentURL).toBe('/foo/123')

		location.mockReturnValue(formatURL('bar/234'))
		window.dispatchEvent(new PopStateEvent('popstate'))
		expect(instance.state.currentURL).toBe('/bar/234')
	})
})