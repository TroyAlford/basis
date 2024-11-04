import React from 'react'
import { deepEquals } from '@basis/utilities'
import { Component } from '../Component/Component'
import { Router } from '../Router/Router'

interface Props {
  defaultRoute?: string,
}

interface RouteDefinition {
  component: React.ComponentType,
  exact?: boolean,
  redirectTo?: string,
}

export class ApplicationBase<
  P extends object = object,
  S extends object = object,
> extends Component<P & Props, HTMLElement, S & { context: ApplicationContext }> {
  static defaultProps = {
    ...Component.defaultProps,
    defaultRoute: '/',
  }
  Context = React.createContext<ApplicationContext>(this.defaultContext)

  get classNames() { return super.classNames.add('application') }
  get defaultContext(): ApplicationContext {
    return {} as ApplicationContext
  }
  get defaultState() {
    return {
      ...super.defaultState,
      context: this.defaultContext,
    }
  }
  readonly tag: keyof React.ReactHTML = 'div'

  constructor(props) {
    super(props)

    if (typeof window !== 'undefined') {
      window.ApplicationBase = this
      window.ApplicationContext = this.Context
    }
  }

  /**
   * Override this getter to define routes
   * @returns Record of route templates to their configurations
   */
  protected get routes(): Record<string, RouteDefinition> {
    return {}
  }

  /**
   * Override this to provide the layout wrapper
   * @param content The router content to be wrapped
   * @returns The layout wrapper
   */
  protected layout(content: React.ReactNode): React.ReactNode {
    return content
  }

  private renderRoutes(): React.ReactNode[] {
    return Object.entries(this.routes).map(([template, config]) => (
      <Router.Route
        key={template}
        exact={config.exact}
        redirectTo={config.redirectTo}
        template={template}
      >
        {(params: Record<string, string>) => {
          const RouteComponent = config.component
          return <RouteComponent {...params} />
        }}
      </Router.Route>
    ))
  }

  content() {
    const { Provider } = this.Context

    return (
      <Provider value={this.state.context}>
        {this.layout(
          <Router>
            {this.renderRoutes()}
          </Router>,
        )}
      </Provider>
    )
  }

  setContext(updates: Partial<ApplicationContext>) {
    const context: ApplicationContext = { ...this.state.context, ...updates }
    if (deepEquals(this.state.context, context)) return

    this.setState(state => ({ ...state, context }))
  }
}
