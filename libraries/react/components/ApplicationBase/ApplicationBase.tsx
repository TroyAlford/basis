import React from 'react'
import { deepEquals } from '@basis/utilities'
import { Component } from '../Component/Component'
import { Router } from '../Router/Router'

interface Props {
  /** The URL to redirect to if no route is matched. */
  defaultRoute?: string,
}

/** A definition for a route. */
interface RouteDefinition {
  /** The component to render for the route. */
  component: React.ComponentType,
  /** Whether the route should be matched exactly. */
  exact?: boolean,
  /** The URL to redirect to if the route is matched. */
  redirectTo?: string,
}

/** A base component for an application. */
export class ApplicationBase<
  /** The props for the application. */
  P extends object = object,
  /** The state for the application. */
  S extends object = object,
  /** The context for the application. */
  C extends object = Record<string, unknown>,
> extends Component<P & Props, HTMLElement, S & { context: C }> {
  static defaultProps: Partial<Props & Component['props']> = {
    ...Component.defaultProps,
    defaultRoute: '/',
  }
  Context: React.Context<C> = React.createContext(this.defaultContext)

  get classNames(): Set<string> { return super.classNames.add('application') }
  get defaultContext(): C {
    return {} as C
  }
  get defaultState(): S & { context: C } {
    return {
      ...super.defaultState,
      context: this.defaultContext,
    }
  }
  readonly tag: keyof React.ReactHTML = 'div'

  constructor(props: P & Props) {
    super(props)

    if (typeof window !== 'undefined') {
      // @ts-expect-error - ApplicationBase is not defined in the global scope
      window.ApplicationBase = this
      // @ts-expect-error - ApplicationContext is not defined in the global scope
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

  /**
   * Renders the routes.
   * @returns The rendered routes
   */
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

  /**
   * Renders the application.
   * @returns The rendered application
   */
  content(): React.ReactNode {
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

  /**
   * Sets the context.
   * @param updates - The updates to the context
   */
  setContext(updates: Partial<C>) {
    const context: C = { ...this.state.context, ...updates }
    if (deepEquals(this.state.context, context)) return

    this.setState(state => ({ ...state, context }))
  }
}
