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
              {() => (<main ref={this.main}><RouteComponent /></main>)}
            </Router.Route>
          ))}
        </Router>
      </>
    )
  }
}
