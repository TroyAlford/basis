import { buildDocumentationNavigation } from 'basis/react'
import { describe, expect, test } from 'bun:test'
import { routes } from './routes'

/**
 * Routes that must remain addressable after the monorepo documentation
 * foundation. Demo-only routes folded into their parent pages are excluded.
 */
const EXISTING = [
  '/',
  '/architecture',
  '/components/auto-complete',
  '/components/await',
  '/components/button',
  '/components/carousel',
  '/components/checkbox-editor',
  '/components/component',
  '/components/dialog',
  '/components/dropdown-menu',
  '/components/editor',
  '/components/enum-editor',
  '/components/image',
  '/components/menu',
  '/components/mermaid',
  '/components/number-editor',
  '/components/notification',
  '/components/option-group',
  '/components/overlay-provider',
  '/components/router',
  '/components/table',
  '/components/tag',
  '/components/tags-editor',
  '/components/text-editor',
  '/components/theme',
  '/components/toggle-editor',
  '/components/tooltip',
  '/compliance',
  '/contributing',
  '/css-linting',
  '/engineering-principles',
  '/guides',
  '/icons',
  '/markdown-linting',
  '/mixins',
  '/reference',
  '/testing',
]

describe('docs routes', () => {
  test('keeps every canonical deep link and the new monorepo pages', () => {
    const pages = routes.filter(route => !route.section).map(route => route.path)

    expect(new Set(pages).size).toBe(pages.length)
    for (const path of EXISTING) expect(pages).toContain(path)
    expect(pages).not.toContain('/components/router/guard-demo')
    expect(pages).not.toContain('/icons/MoonPhase')

    expect(pages).toContain('/react')
    expect(pages).toContain('/installation')
    expect(pages).toContain('/server')
    expect(pages).toContain('/configuration')
    expect(pages).toContain('/logging')
    expect(pages).toContain('/oauth')
    expect(pages).toContain('/utilities')
    expect(pages).toContain('/cli')
    expect(pages).toContain('/eslint')
    expect(pages).toContain('/typescript')
    expect(pages).toContain('/build-plugins')
    expect(pages).toContain('/review')
    expect(pages).toContain('/workspaces')
    expect(pages).toContain('/ci')
  })

  test('publishes the exact top-level section order', () => {
    const navigation = buildDocumentationNavigation(routes.map(route => ({
      href: route.path,
      parent: route.parent,
      section: route.section,
      title: route.title,
    })))

    expect(navigation.map(entry => entry.title)).toEqual([
      'Philosophy',
      'Getting Started',
      'Server & Core Libraries',
      'React Foundations',
      'React Components',
      'Development & Tooling',
    ])
    expect(navigation.every(entry => entry.section)).toBe(true)
  })
})
