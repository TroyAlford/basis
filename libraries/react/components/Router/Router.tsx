import * as React from 'react'
import { parseTemplateURI } from '@basis/utilities'
import { Component } from '../Component/Component'

interface Props {
  children: React.ReactNode,
}

interface RouteProps<P = object> {
  children: (params: P) => React.ReactNode | React.ReactNode,
  exact?: boolean,
  redirectTo?: string,
  template: string,
}

interface LinkProps {
  children: React.ReactNode,
  to: string,
}

interface SwitchProps {
  children: React.ReactNode,
}

interface RedirectProps {
  to: string,
}

interface State {
  currentURL: string,
}

export class Router extends Component<Props, null, State> {
  static Route = class Route<P> extends React.Component<RouteProps<P>> { }

  static Switch = class Switch extends React.Component<SwitchProps> {
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

  static Link = class Link extends React.Component<LinkProps> {
    handleClick = (e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
      e.preventDefault()
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

  static Redirect = class Redirect extends React.Component<RedirectProps> {
    componentDidMount() {
      const { to } = this.props
      window.history.replaceState({}, '', to)
    }

    render() {
      return null
    }
  }

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

  handleNavigate = () => {
    const newURL = window.location.pathname + window.location.search
    if (newURL !== this.state.currentURL) {
      this.setState({ currentURL: newURL })
    }
  }

  patchHistoryMethods = () => {
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

  renderRoute = () => {
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
