import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { buildDocumentationNavigation, Documentation } from './Documentation'

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

  test('renders ordered section headings with nested clickable entries', async () => {
    const navigation = buildDocumentationNavigation([
      { href: 'section:getting-started', section: true, title: 'Getting Started' },
      { href: '/installation', parent: 'section:getting-started', title: 'Installation' },
      { href: '/guides', parent: 'section:getting-started', title: 'Guides' },
      { href: 'section:react', section: true, title: 'React Foundations' },
      { href: '/react', parent: 'section:react', title: 'React overview' },
    ])
    const { node } = await render(<Documentation navigation={navigation}>content</Documentation>)

    const sections = Array.from(node.querySelectorAll('li.section > .section-title'))
      .map(heading => heading.textContent)
    expect(sections).toEqual(['Getting Started', 'React Foundations'])
    expect(node.querySelector('li.section > .section-title a')).toBeNull()

    const links = Array.from(node.querySelectorAll('nav.links a')).map(link => link.textContent)
    expect(links).toEqual(['Installation', 'Guides', 'React overview'])
  })
})
