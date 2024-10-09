import type { Mock } from 'bun:test'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Router } from './Router'

describe('Router', () => {
  let pushState: Mock<History['pushState']>
  let replaceState: Mock<History['replaceState']>

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: {
        href: 'http://example.com/',
        pathname: '/',
        search: '',
        toString() { return this.href },
      },
      writable: true,
    })

    pushState = spyOn(window.history, 'pushState').mockImplementation((state, title, url) => {
      const [path, search] = url.toString().split('?')
      window.location.pathname = path
      window.location.search = search ? '?' + search : ''
      window.location.href = 'http://example.com' + window.location.pathname + window.location.search
    })

    replaceState = spyOn(window.history, 'replaceState').mockImplementation((state, title, url) => {
      const [path, search] = url.toString().split('?')
      window.location.pathname = path
      window.location.search = search ? '?' + search : ''
      window.location.href = 'http://example.com' + window.location.pathname + window.location.search
    })
  })

  afterEach(() => {
    pushState.mockRestore()
    replaceState.mockRestore()
  })

  describe('matches routes', () => {
    const router = (
      <Router>
        <Router.Route template="/pages/:slug">
          {({ slug }) => (
            <div className="page">
              {slug}
            </div>
          )}
        </Router.Route>
        <Router.Route template="/error/:code">
          {({ code }) => (
            <div className="error">
              {code}
            </div>
          )}
        </Router.Route>
        <Router.Route template="/:type/:id">
          {({ id, type }) => <div data-id={id} data-type={type} />}
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
      window.location.pathname = '/' + url
      const { node } = render<Router>(router)
      expect(node.matches(selector)).toBe(true)
      expect(node.textContent).toBe(textContent)
    })

    test('renders a new route when the path changes', async () => {
      window.history.pushState({}, '', '/bar/234')
      const rendered = render<Router>(router)
      expect(rendered.node.outerHTML).toEqual('<div data-id="234" data-type="bar"></div>')

      window.history.pushState({}, '', '/qux/456')

      // Wait for the state to update
      await new Promise(resolve => setTimeout(resolve, 0))
      rendered.update()

      expect(rendered.node.outerHTML).toEqual('<div data-id="456" data-type="qux"></div>')
    })

    test('renders null when no route matches', () => {
      window.location.pathname = '/non/matching/route'
      const { node } = render<Router>(router)
      expect(node).toBeNull()
    })

    test('responds to popstate events', () => {
      window.location.pathname = '/foo/123'
      const rendered = render<Router>(router)
      expect(rendered.node.outerHTML)
        .toEqual('<div data-id="123" data-type="foo"></div>')

      window.location.pathname = '/bar/234'
      window.dispatchEvent(new PopStateEvent('popstate'))
      expect(rendered.update().node.outerHTML)
        .toEqual('<div data-id="234" data-type="bar"></div>')
    })
  })
})
