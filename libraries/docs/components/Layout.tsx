import * as React from 'react'
import { Component, Router, Theme } from '@basis/react'
import { NavigateEvent } from '../../react/events/NavigateEvent'
import { routes } from '../routes.ts'

import './Layout.styles.ts'

export class Layout extends Component {
  static displayName = 'Layout'

  main = React.createRef<HTMLDivElement>()

  private handleNavigate = (): void => {
    this.main.current?.scrollTo({ top: 0 })
  }

  componentDidMount(): void {
    window.addEventListener(NavigateEvent.name, this.handleNavigate as EventListener)
  }

  componentWillUnmount(): void {
    window.removeEventListener(NavigateEvent.name, this.handleNavigate as EventListener)
  }

  override content(): React.ReactNode {
    // Build tree structure
    const routeTree = routes.reduce((tree, route) => {
      if (route.parent) {
        // Find parent in tree
        const parentRoute = routes.find(r => r.path === route.parent)
        if (parentRoute) {
          if (!tree[parentRoute.path]) {
            tree[parentRoute.path] = { children: [], route: parentRoute }
          }
          tree[parentRoute.path].children.push(route)
        } else {
          // Parent not found, add as root
          tree[route.path] = { children: [], route }
        }
      } else {
        // No parent, add as root
        tree[route.path] = { children: [], route }
      }
      return tree
    }, {} as Record<string, { children: typeof routes, route: typeof routes[0] }>)

    // Convert to sorted array
    const sortedRoutes = Object.values(routeTree).sort((a, b) => a.route.title.localeCompare(b.route.title))

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
        <Router>
          {routes.map(({ component: RouteComponent, path }) => (
            <Router.Route key={path} template={path}>
              {() => (<main ref={this.main}><RouteComponent /></main>)}
            </Router.Route>
          ))}
        </Router>
      </>
    )
  }
}
