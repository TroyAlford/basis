import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { NavigateEvent } from '../../events/NavigateEvent'
import { render } from '../../testing/render'
import { Link } from './Link'

describe('Link', () => {

  test('renders an anchor tag with the correct href', async () => {
    const { node } = await render<Link>(
      <Link to="/some/path">Click me</Link>,
    )
    expect(node.tagName).toBe('A')
    expect(node.getAttribute('href')).toBe('/some/path')
    expect(node.textContent).toBe('Click me')
  })

  test('updates active state when location changes', async () => {
    const { node } = await render<Link>(
      <Link to="/current">Current</Link>,
    )

    // Initially not active since we're at '/'
    expect(node.getAttribute('data-active')).toBe('false')

    // Change location to match link target
    window.location.pathname = '/current'
    const navigateEvent = new NavigateEvent('/current')
    window.dispatchEvent(navigateEvent)

    // Wait for the event to be processed
    await new Promise(resolve => setTimeout(resolve, 0))

    // Should now be active
    expect(node.getAttribute('data-active')).toBe('true')
  })

  test('prevents navigation when already active', async () => {
    window.location.pathname = '/current'

    const { instance } = await render<Link>(
      <Link to="/current">Current</Link>,
    )

    const event = new MouseEvent('click')
    instance.handleClick(event as unknown as React.MouseEvent<HTMLAnchorElement, MouseEvent>)

    // Should still be at the same location since navigation was prevented
    expect(window.location.pathname).toBe('/current')
  })

  test('allows navigation when not active', async () => {
    const { instance } = await render<Link>(
      <Link to="/new/path">Navigate</Link>,
    )

    const event = new MouseEvent('click')
    instance.handleClick(event as unknown as React.MouseEvent<HTMLAnchorElement, MouseEvent>)

    // Should now be at the new location
    expect(window.location.pathname).toBe('/new/path')
  })
})
