import type { Mock } from 'bun:test'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Link } from './Link'

describe('Link', () => {
  let pushState: Mock<History['pushState']>

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
  })

  afterEach(() => {
    pushState.mockRestore()
  })

  test('renders an anchor tag with the correct href', async () => {
    const { node } = await render<Link>(
      <Link to="/some/path">Click me</Link>,
    )
    expect(node.tagName).toBe('A')
    expect(node.getAttribute('href')).toBe('/some/path')
    expect(node.textContent).toBe('Click me')
  })

  test('uses pushState for client-side navigation', async () => {
    const { instance } = await render<Link>(
      <Link to="/new/path">Navigate</Link>,
    )

    const event = new MouseEvent('click')
    instance.handleClick(event as unknown as React.MouseEvent<HTMLAnchorElement, MouseEvent>)

    expect(pushState).toHaveBeenCalledTimes(1)
  })
})
