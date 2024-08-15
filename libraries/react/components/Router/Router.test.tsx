import type { Mock } from 'bun:test'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Router } from './Router'

describe('Router', () => {
	const formatURL = (url: string) => `http://example.com/${url}`
	let location: Mock<Location['toString']>

	beforeEach(() => {
		location = spyOn(window.location, 'toString')
	})

	afterEach(() => {
		location.mockRestore()
	})

	describe('matches routes', () => {
		const router = (
			<Router>
				<Router.Route template="/pages/:slug">
					{({ slug }) => <div className="page">{slug}</div>}
				</Router.Route>
				<Router.Route template="/error/:code">
					{({ code }) => <div className="error">{code}</div>}
				</Router.Route>
				<Router.Route template="/:type/:id">
					{({ type, id }) => <div data-id={id} data-type={type} />}
				</Router.Route>
			</Router>
		)

		test.each([
			['pages/foo', '.page', 'foo'],
			['pages/bar', '.page', 'bar'],
			['foo/123', '[data-id="123"][data-type="foo"]', ''],
			['bar/456', '[data-id="456"][data-type="bar"]', ''],
			['error/404', '.error', '404'],
			['error/500', '.error', '500'],
		])('and passes templated params as props', (url, selector, textContent) => {
			location.mockReturnValue(formatURL(url))
			const { node } = render<Router>(router)
			expect(node.matches(selector)).toBe(true)
			expect(node.textContent).toBe(textContent)
		})

		test('renders a new route when the path changes', () => {
			location.mockReturnValue(formatURL('bar/234'))
			const rendered = render<Router>(router)
			expect(rendered.node.outerHTML)
				.toEqual('<div data-id="234" data-type="bar"></div>')

			location.mockReturnValue(formatURL('qux/456'))
			expect(rendered.update().node.outerHTML)
				.toEqual('<div data-id="456" data-type="qux"></div>')
		})

		test('renders null when no route matches', () => {
			location.mockReturnValue(formatURL('non/matching/route'))
			const { node } = render<Router>(router)
			expect(node).toBeNull()
		})

		test('responds to popstate events', () => {
			location.mockReturnValue(formatURL('foo/123'))
			const rendered = render<Router>(router)
			expect(rendered.node.outerHTML)
				.toEqual('<div data-id="123" data-type="foo"></div>')

			location.mockReturnValue(formatURL('bar/234'))
			window.dispatchEvent(new PopStateEvent('popstate'))
			expect(rendered.update().node.outerHTML)
				.toEqual('<div data-id="234" data-type="bar"></div>')
		})
	})
})
