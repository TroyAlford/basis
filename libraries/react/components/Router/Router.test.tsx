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

  test('matches routes and passes templated params as props', () => {
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
    const { node } = render<Router>(router)
    expect(node.matches('.page')).toBe(true)
    expect(node.textContent).toBe('foo')
  })

  test('renders a new route when the path changes', async () => {
    const router = (
      <Router>
        <Router.Route template="/:type/:id">
          {({ id, type }) => <div data-id={id} data-type={type} />}
        </Router.Route>
      </Router>
    )

    window.history.pushState({}, '', '/bar/234')
    const rendered = render<Router>(router)
    expect(rendered.node.outerHTML).toEqual('<div data-id="234" data-type="bar"></div>')

    window.history.pushState({}, '', '/qux/456')
    await new Promise(resolve => setTimeout(resolve, 0))
    rendered.update()

    expect(rendered.node.outerHTML).toEqual('<div data-id="456" data-type="qux"></div>')
  })

  test('renders null when no route matches', () => {
    const router = (
      <Router>
        <Router.Route template="/foo">
          <div>Foo</div>
        </Router.Route>
      </Router>
    )

    window.location.pathname = '/non/matching/route'
    const { node } = render<Router>(router)
    expect(node).toBeNull()
  })

  test('responds to popstate events', async () => {
    const router = (
      <Router>
        <Router.Route template="/:id">
          {({ id }) => (
            <div>
              {id}
            </div>
          )}
        </Router.Route>
      </Router>
    )

    window.location.pathname = '/123'
    const rendered = render<Router>(router)
    expect(rendered.node.textContent).toBe('123')

    window.location.pathname = '/456'
    window.dispatchEvent(new PopStateEvent('popstate'))

    // Wait for state update
    await new Promise(resolve => setTimeout(resolve, 0))
    rendered.update()

    expect(rendered.node.textContent).toBe('456')
  })
})
