import * as React from 'react'
import { parseTemplateURI } from '@basis/utilities'
import { Component } from '../Component/Component'

interface Props {
  /** The children to render. */
  children: React.ReactNode,
}

interface RouteProps<P = object> {
  /** The children to render. */
  children: (params: P) => React.ReactNode | React.ReactNode,
  /** Whether to match the exact path. */
  exact?: boolean,
  /** The URL to redirect to. */
  redirectTo?: string,
  /** The template to match. */
  template: string,
}

interface LinkProps {
  /** The children to render. */
  children: React.ReactNode,
  /** The URL to navigate to. */
  to: string,
}

interface SwitchProps {
  /** The children to render. */
  children: React.ReactNode,
}

interface RedirectProps {
  /** The URL to redirect to. */
  to: string,
}

interface State {
  /** The current URL. */
  currentURL: string,
}

/** A component for routing between pages. */
export class Router extends Component<Props, null, State> {
  /** A component for matching a route. */
  static Route: React.ComponentType<RouteProps<unknown>> = (
    class Route<P> extends React.Component<RouteProps<P>> { }
  )

  /** A component for switching between routes. */
  static Switch: React.ComponentType<SwitchProps> = (
    class Switch extends React.Component<SwitchProps> {
      render() {
        const child = React.Children.toArray(this.props.children)
          .find(c => React.isValidElement(c))
        return (
          <React.Fragment>
            {child}
          </React.Fragment>
        )
      }
    }
  )

  /** A component for navigating to a URL. */
  static Link: React.ComponentType<LinkProps> = (
    class Link extends React.Component<LinkProps> {
      /**
       * Handles the click event.
       * @param event - The mouse event.
       */
      handleClick = (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
        event.preventDefault()
        window.history.pushState({}, '', this.props.to)
      }

      render() {
        const { children, to } = this.props
        return (
          <a href={to} onClick={this.handleClick}>
            {children}
          </a>
        )
      }
    }
  )

  /** A component for redirecting to a URL. */
  static Redirect: React.ComponentType<RedirectProps> = (
    class Redirect extends React.Component<RedirectProps> {
      componentDidMount(): void {
        const { to } = this.props
        window.history.replaceState({}, '', to)
      }

      render() {
        return null
      }
    }
  )

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

  /** Handles the navigation. */
  handleNavigate = (): void => {
    const newURL = window.location.pathname + window.location.search
    if (newURL !== this.state.currentURL) {
      this.setState({ currentURL: newURL })
    }
  }

  /** Patches the history methods. */
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
   * Renders the route.
   * @returns The rendered route.
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

  render = () => (
    <React.Fragment>
      {this.renderRoute()}
    </React.Fragment>
  )
}
