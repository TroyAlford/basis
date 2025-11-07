import * as React from 'react'
import { parseTemplateURI } from '@basis/utilities'
import { NavigateEvent } from '../../events/NavigateEvent'
import { Component } from '../Component/Component'
import { Link } from './Link'
import { Location } from './Location'
import { handleNavigationScrolling, navigate } from './navigate'
import { Redirect } from './Redirect'
import { Route } from './Route'
import { Switch } from './Switch'

/** Props for the Router component */
interface Props {
  /** The routes to render */
  children: React.ReactNode,
  /** The URL to use for server-side rendering (pathname + search) */
  url?: string,
}

const WILDCARD_ROUTES = ['*', '.*']

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
export class Router extends Component<Props> {
  static Link = Link
  static Route = Route
  static Switch = Switch
  static Redirect = Redirect
  static navigate = navigate

  static get serverSide() { return typeof window === 'undefined' }
  static get location() { return Router.serverSide ? new Location() : window.location }
  static get search() { return Router.serverSide ? '' : Router.location.search ?? '' }
  static get origin() { return Router.serverSide ? '' : Router.location.origin ?? '' }
  static get href() { return Router.serverSide ? '' : Router.location.href ?? '' }
  static get windowURL() {
    return Router.serverSide
      ? ''
      : Router.location.pathname + Router.location.search
  }

  componentDidMount(): void {
    window.addEventListener(NavigateEvent.name, this.#handleUpdate)
    window.addEventListener('popstate', this.#handleUpdate)
  }

  componentWillUnmount(): void {
    window.removeEventListener(NavigateEvent.name, this.#handleUpdate)
    window.removeEventListener('popstate', this.#handleUpdate)
  }

  #handleUpdate = (): void => {
    this.forceUpdate()
    if (typeof window !== 'undefined') {
      handleNavigationScrolling(window.location.href)
    }
  }

  /**
   * Renders the matching route
   * @returns The rendered route or null if no match
   */
  renderRoute = (): React.ReactNode | null => {
    /*
     * During hydration, use SSR URL if available, otherwise use window URL
     * This ensures server and client render the same route
     */
    const currentURL = this.props.url ?? Router.windowURL
    const route = React.Children.toArray(this.props.children).find(child => {
      if (!React.isValidElement(child) || child.type !== Router.Route) return false

      const template = (child.props as Route<unknown>['props']).template

      // Handle wildcard route - always matches, don't parse
      if (WILDCARD_ROUTES.includes(template)) return true

      // Handle static routes (exact path matches)
      if (template === currentURL) return true

      // Handle dynamic routes (using parseTemplateURI)
      return !!parseTemplateURI(currentURL, template)
    }) as React.ReactElement<Route<unknown>['props']> | undefined

    if (route) {
      const { children, redirectTo, template } = route.props as Route<unknown>['props']

      const params = WILDCARD_ROUTES.includes(template)
        ? {} // Wildcard routes don't have params to parse
        : parseTemplateURI(currentURL, template) || {}

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
