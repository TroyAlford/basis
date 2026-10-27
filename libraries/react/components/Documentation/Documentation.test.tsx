import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Documentation } from './Documentation'

describe('Documentation', () => {
  test('keeps the icon and title outside the scrolling navigation entries', async () => {
    const { node } = await render(
      <Documentation
        active="/"
        icon={<span data-testid="nav-icon">icon</span>}
        title="Docs"
        navigation={[
          { href: '/', title: 'Home' },
          { href: '/guide', title: 'Guide' },
        ]}
      >
        <p>Content</p>
      </Documentation>,
    )

    const nav = node.querySelector('nav.links')
    const header = nav?.querySelector(':scope > h1')
    const entries = nav?.querySelector(':scope > .entries')

    expect(header?.textContent).toBe('iconDocs')
    expect(header?.querySelector('[data-testid="nav-icon"]')).not.toBeNull()
    expect(entries).not.toBeNull()
    expect(entries?.contains(header ?? null)).toBe(false)
    expect(entries?.querySelectorAll('a')).toHaveLength(2)
    expect(node.querySelector('main')?.textContent).toBe('Content')
  })
})
