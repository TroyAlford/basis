import * as React from 'react'
import { parseTemplateURI } from '@basis/utilities'
import { Component } from '../Component/Component'
import { Link } from './Link'
import { Redirect } from './Redirect'
import type { RouteProps } from './Route'
import { Route } from './Route'
import { Switch } from './Switch'

/** Props for the Router component */
interface Props {
  /** The routes to render */
  children: React.ReactNode,
}

/** State for the Router component */
interface State {
  /** The current URL */
  currentURL: string,
}

/**
 * A component for client-side routing between pages
 * @example
 * <Router>
 *   <Router.Switch>
 *     <Router.Route template="/users/:id">
 *       {params => <UserProfile id={params.id} />}
 *     </Router.Route>
 *     <Router.Route template="/">
 *       <HomePage />
 *     </Router.Route>
 *   </Router.Switch>
 * </Router>
 */
export class Router extends Component<Props, null, State> {
  static Link = Link
  static Route = Route
  static Switch = Switch
  static Redirect = Redirect

  state = {
    currentURL: window.location.pathname + window.location.search,
  }

  componentDidMount(): void {
    window.addEventListener('popstate', this.handleNavigate)
    this.patchHistoryMethods()
  }

  componentWillUnmount(): void {
    window.removeEventListener('popstate', this.handleNavigate)
  }

  /** Handles URL navigation */
  handleNavigate = (): void => {
    const newURL = window.location.pathname + window.location.search
    if (newURL !== this.state.currentURL) {
      this.setState({ currentURL: newURL })
    }
  }

  /** Patches history methods to trigger navigation handling */
  patchHistoryMethods = (): void => {
    const { pushState, replaceState } = window.history

    window.history.pushState = (...args) => {
      pushState.apply(window.history, args)
      this.handleNavigate()
    }

    window.history.replaceState = (...args) => {
      replaceState.apply(window.history, args)
      this.handleNavigate()
    }
  }

  /**
   * Renders the matching route
   * @returns The rendered route or null if no match
   */
  renderRoute = (): React.ReactNode | null => {
    const { currentURL } = this.state
    const route = React.Children.toArray(this.props.children).find(child => {
      if (!React.isValidElement(child) || child.type !== Router.Route) return false
      return !!parseTemplateURI(currentURL, child.props.template)
    }) as React.ReactElement<RouteProps<unknown>> | undefined

    if (route) {
      const { children, redirectTo, template } = route.props
      const params = parseTemplateURI(currentURL, template)

      if (redirectTo) return <Router.Redirect to={redirectTo} />
      if (typeof children === 'function') return children(params)
      if (React.isValidElement(children)) return children
    }

    return null
  }

  render(): React.ReactNode {
    return (
      <React.Fragment>
        {this.renderRoute()}
      </React.Fragment>
    )
  }
}
