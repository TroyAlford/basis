import { beforeEach, describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Router } from './Router'

describe('Router', () => {
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
  })

  test('matches routes and passes templated params as props', async () => {
    const router = (
      <Router>
        <Router.Route template="/pages/:slug">
          {({ slug }) => (
            <div className="page">
              {slug}
            </div>
          )}
        </Router.Route>
      </Router>
    )

    window.location.pathname = '/pages/foo'
    const { node } = await render<Router>(router)
    expect(node.matches('.page')).toBe(true)
    expect(node.textContent).toBe('foo')
  })

  test('renders route based on current location', async () => {
    const router = (
      <Router>
        <Router.Route template="/:type/:id">
          {({ id, type }) => <div data-id={id} data-type={type} />}
        </Router.Route>
      </Router>
    )

    // Test first route
    window.location.pathname = '/bar/234'
    const rendered = await render<Router>(router)
    expect(rendered.node.outerHTML).toEqual('<div data-id="234" data-type="bar"></div>')
  })

  test('renders different route for different location', async () => {
    const router = (
      <Router>
        <Router.Route template="/:type/:id">
          {({ id, type }) => <div data-id={id} data-type={type} />}
        </Router.Route>
      </Router>
    )

    // Test second route
    window.location.pathname = '/qux/456'
    const rendered = await render<Router>(router)
    expect(rendered.node.outerHTML).toEqual('<div data-id="456" data-type="qux"></div>')
  })

  test('renders null when no route matches', async () => {
    const router = (
      <Router>
        <Router.Route template="/foo">
          <div>Foo</div>
        </Router.Route>
      </Router>
    )

    window.location.pathname = '/non/matching/route'
    const { node } = await render<Router>(router)
    expect(node).toBeNull()
  })

  test('handles query parameters in URL', async () => {
    const router = (
      <Router>
        <Router.Route template="/search">
          <div>Search Results</div>
        </Router.Route>
      </Router>
    )

    window.location.pathname = '/search'
    window.location.search = '?q=test&page=1'
    const { node } = await render<Router>(router)
    expect(node.textContent).toBe('Search Results')
  })

  test('handles root path correctly', async () => {
    const router = (
      <Router>
        <Router.Route template="/">
          <div>Home Page</div>
        </Router.Route>
      </Router>
    )

    window.location.pathname = '/'
    const { node } = await render<Router>(router)
    expect(node.textContent).toBe('Home Page')
  })
})
