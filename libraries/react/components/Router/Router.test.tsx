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
	})
})