import type { DocumentationEntry } from 'basis/react'
import { ApplicationBase, buildDocumentationNavigation, Documentation, Theme } from 'basis/react'
import type { ComponentType, ReactNode } from 'react'
import { routes } from '../routes.ts'

/**
 * The docs application shell. It composes the shared {@link Documentation}
 * surface — the same one the static documentation build renders — so the
 * gallery and the published documentation have one presentation.
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
    return buildDocumentationNavigation(routes.map(route => ({
      href: route.path,
      parent: route.parent,
      title: route.title.split('/').pop() ?? route.title,
    })))
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
