import type { ComponentType, ReactNode } from 'react'
import type { DocumentationEntry } from '@basis/react'
import { ApplicationBase, Documentation, Theme } from '@basis/react'
import { routes } from '../routes.ts'

/**
 * The docs application shell. It composes the shared {@link Documentation}
 * surface — the same one `Server.docs()` renders — so the gallery and the
 * served documentation have one presentation.
 */
export class Layout extends ApplicationBase {
  static displayName = 'Layout'

  protected get routes(): Record<string, { component: ComponentType<unknown> }> {
    return Object.fromEntries(routes.map(route => [route.path, { component: route.component }]))
  }

  /**
   * The navigation tree, nested by each route's declared parent.
   * @returns The navigation entries.
   */
  protected get navigation(): DocumentationEntry[] {
    const entries = new Map<string, DocumentationEntry>()
    for (const route of routes) {
      entries.set(route.path, { href: route.path, title: route.title.split('/').pop() ?? route.title })
    }

    const roots: DocumentationEntry[] = []
    for (const route of routes) {
      const entry = entries.get(route.path)
      if (!entry) continue
      const parent = route.parent ? entries.get(route.parent) : undefined
      if (parent) parent.children = [...(parent.children ?? []), entry]
      else roots.push(entry)
    }

    return roots.sort((a, b) => a.title.localeCompare(b.title))
  }

  protected layout(content: ReactNode): ReactNode {
    const active = typeof window === 'undefined' ? undefined : window.location.pathname
    return (
      <>
        <Theme />
        <Documentation active={active} navigation={this.navigation} title="Basis Docs">
          {content}
        </Documentation>
      </>
    )
  }

  protected route(outlet: ReactNode): ReactNode {
    return outlet
  }
}
