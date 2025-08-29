import * as React from 'react'
import { Component, Router, Theme } from '@basis/react'
import { routes } from '../routes.ts'

import './Layout.styles.ts'

export class Layout extends Component {
  static displayName = 'Layout'

  override content(): React.ReactNode {
    return (
      <>
        <Theme />
        <nav className="links">
          <h1>Basis Docs</h1>
          <div className="links">
            {routes.map(route => (
              <Router.Link key={route.path} to={route.path}>{route.title}</Router.Link>
            ))}
          </div>
        </nav>
        <Router>
          {routes.map(({ component: RouteComponent, path }) => (
            <Router.Route key={path} template={path}>
              {() => (<main><RouteComponent /></main>)}
            </Router.Route>
          ))}
        </Router>
      </>
    )
  }
}
