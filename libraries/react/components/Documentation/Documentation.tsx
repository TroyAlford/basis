import * as React from 'react'
import { Component } from '../Component/Component'

import '../../global.styles.ts'
import './Documentation.styles.ts'

/** A documentation navigation entry. */
export interface DocumentationEntry {
  /** Nested navigation entries. */
  children?: DocumentationEntry[],
  /** Absolute link target. */
  href: string,
  /** Display title. */
  title: string,
}

interface Props {
  /** Current route path, highlighted in the navigation. */
  active?: string,
  /** Page content. */
  children?: React.ReactNode,
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
    return (
      <ul>
        {entries.map(entry => (
          <li key={entry.href}>
            <a data-active={entry.href === this.props.active ? 'true' : undefined} href={entry.href}>
              {entry.title}
            </a>
            {entry.children && entry.children.length > 0 ? this.#renderEntries(entry.children) : null}
          </li>
        ))}
      </ul>
    )
  }

  content(): React.ReactNode {
    const { children, navigation = [], title } = this.props
    return (
      <>
        <nav className="links">
          <h1>{title}</h1>
          {this.#renderEntries(navigation)}
        </nav>
        <main>{children}</main>
      </>
    )
  }
}
