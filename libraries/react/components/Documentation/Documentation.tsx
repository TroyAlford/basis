import * as React from 'react'
import { Component } from '../Component/Component'
import { Link } from '../Router/Link'

import '../../global.styles.ts'
import './Documentation.styles.ts'

/** A documentation navigation entry. */
export interface DocumentationEntry {
  /** Nested navigation entries. */
  children?: DocumentationEntry[],
  /** Stable key and optional link target. */
  href: string,
  /** Render a non-clickable section heading instead of a link. */
  section?: boolean,
  /** Display title. */
  title: string,
}

/** A flat documentation route, before it is nested for navigation. */
export interface DocumentationRoute {
  /** Absolute link target or stable section key. */
  href: string,
  /** The href of the parent entry, for nesting. */
  parent?: string,
  /** Render a non-clickable section heading instead of a link. */
  section?: boolean,
  /** Display title. */
  title: string,
}

/**
 * Build the nested documentation navigation from a flat route list, nesting
 * each entry under the parent named by its `parent` href.
 *
 * This is the one place the documentation tree is shaped: the docs app and the
 * static documentation build both feed their routes through it, so navigation
 * nests the same way everywhere.
 * The caller owns the order; this function never sorts.
 * @param routes - The routes, in their intended sibling order.
 * @returns The navigation entries in their declared order.
 */
export function buildDocumentationNavigation(routes: readonly DocumentationRoute[]): DocumentationEntry[] {
  const entries = new Map<string, DocumentationEntry>()
  for (const route of routes) {
    entries.set(route.href, {
      href: route.href,
      ...(route.section ? { section: true } : {}),
      title: route.title,
    })
  }

  const roots: DocumentationEntry[] = []
  for (const route of routes) {
    const entry = entries.get(route.href)
    if (!entry) continue
    const parent = route.parent ? entries.get(route.parent) : undefined
    if (parent) parent.children = [...(parent.children ?? []), entry]
    else roots.push(entry)
  }

  return roots
}

interface Props {
  /** Current route path, highlighted in the navigation. */
  active?: string,
  /** Page content. */
  children?: React.ReactNode,
  /** Optional icon rendered before the site title. */
  icon?: React.ReactNode,
  /** Navigation entries, optionally nested. */
  navigation?: DocumentationEntry[],
  /** Site title shown above the navigation. */
  title?: string,
}

/**
 * Basis's documentation shell: a navigation sidebar beside the page content,
 * typed by the active theme. This is the single documentation presentation,
 * shared by the docs app (client) and the static documentation build, so a
 * published page looks the same as the app.
 */
export class Documentation extends Component<Props> {
  static displayName = 'DocumentationShell'
  static defaultProps = {
    ...Component.defaultProps,
    navigation: [] as DocumentationEntry[],
    title: 'Documentation',
  }

  #renderEntries(entries: DocumentationEntry[]): React.ReactNode {
    /*
     * A static render cannot derive the active route from the location, so the
     * shell's `active` prop is forced there; on the client the Link derives it
     * and updates as the route changes.
     */
    const active = typeof window === 'undefined' ? this.props.active : undefined
    return (
      <ul>
        {entries.map(entry => (
          <li key={entry.href} className={entry.section ? 'section' : undefined}>
            {this.#renderEntry(entry, active)}
            {entry.children && entry.children.length > 0 ? this.#renderEntries(entry.children) : null}
          </li>
        ))}
      </ul>
    )
  }

  /**
   * Render a section heading or a page link.
   * @param entry - The navigation entry.
   * @param active - The active route for a static render.
   * @returns The heading or link.
   */
  #renderEntry(entry: DocumentationEntry, active: string | undefined): React.ReactNode {
    if (entry.section) return <h2 className="section-title">{entry.title}</h2>
    return (
      <Link active={active === undefined ? undefined : entry.href === active} to={entry.href}>
        {entry.title}
      </Link>
    )
  }

  content(): React.ReactNode {
    const { children, icon, navigation = [], title } = this.props
    return (
      <>
        <nav className="links">
          <h1>{icon}{title}</h1>
          <div className="entries">{this.#renderEntries(navigation)}</div>
        </nav>
        <main>
          <div className="content">{children}</div>
        </main>
      </>
    )
  }
}
