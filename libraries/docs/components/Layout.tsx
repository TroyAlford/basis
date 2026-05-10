import * as React from 'react'
import { ApplicationBase, Router, Theme } from '@basis/react'
import { routes } from '../routes.ts'

import './Layout.styles.ts'

export class Layout extends ApplicationBase {
  static displayName = 'Layout'

  main = React.createRef<HTMLElement>()

  protected get routes(): Record<string, { component: React.ComponentType }> {
    return Object.fromEntries(routes.map(route => [route.path, { component: route.component }]))
  }

  protected layout(content: React.ReactNode): React.ReactNode {
    const routeTree = routes.reduce((tree, route) => {
      if (route.parent) {
        const parentRoute = routes.find(r => r.path === route.parent)
        if (parentRoute) {
          if (!tree[parentRoute.path]) {
            tree[parentRoute.path] = { children: [], route: parentRoute }
          }
          tree[parentRoute.path].children.push(route)
        } else {
          tree[route.path] = { children: [], route }
        }
      } else {
        tree[route.path] = { children: [], route }
      }
      return tree
    }, {} as Record<string, { children: typeof routes, route: typeof routes[0] }>)

    const sortedRoutes = Object.values(routeTree).sort((a, b) => (
      a.route.title.localeCompare(b.route.title)
    ))

    const renderRouteTree = (routeNodes: typeof sortedRoutes): React.ReactNode => (
      <ul>
        {routeNodes.map(({ children, route }) => (
          <li key={route.path}>
            <Router.Link to={route.path}>
              {route.title}
            </Router.Link>
            {children.length > 0 && (
              <ul>
                {children.map(childRoute => (
                  <li key={childRoute.path}>
                    <Router.Link to={childRoute.path}>
                      {childRoute.title.split('/').pop()}
                    </Router.Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    )

    return (
      <>
        <Theme />
        <nav className="links">
          <h1>Basis Docs</h1>
          {renderRouteTree(sortedRoutes)}
        </nav>
        <main ref={this.main}>{content}</main>
      </>
    )
  }

  protected route(outlet: React.ReactNode): React.ReactNode {
    return outlet
  }
}
