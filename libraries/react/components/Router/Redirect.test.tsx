import type { Mock } from 'bun:test'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Redirect } from './Redirect'

describe('Redirect', () => {
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

    replaceState = spyOn(window.history, 'replaceState').mockImplementation((state, title, url) => {
      const [path, search] = url.toString().split('?')
      window.location.pathname = path
      window.location.search = search ? '?' + search : ''
      window.location.href = 'http://example.com' + window.location.pathname + window.location.search
    })
  })

  afterEach(() => {
    replaceState.mockRestore()
  })

  test('redirects to the specified path on mount', async () => {
    await render<Redirect>(<Redirect to="/redirect/path" />)
    expect(window.location.pathname).toBe('/redirect/path')
    expect(replaceState).toHaveBeenCalledTimes(1)
  })

  test('renders nothing', async () => {
    const { node } = await render<Redirect>(<Redirect to="/some/path" />)
    expect(node).toBeNull()
  })
})
