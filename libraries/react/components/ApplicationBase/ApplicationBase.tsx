import * as React from 'react'
import { deepEquals } from '../../../utilities'
import type { ApplicationRuntime, ServerEvent, SubscriptionDefinition } from '../../runtime'
import { readBasisRuntime, ServerSubscriptions } from '../../runtime'
import { Component } from '../Component/Component'
import { OverlayProvider } from '../OverlayProvider/OverlayProvider'
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

/**
 * The base component for a Basis application.
 *
 * ApplicationBase is the client composition root. It owns two contexts:
 *
 * - the application's typed **domain context** (`C`), updated by the concrete
 *   Application through {@link ApplicationBase.setContext}; and
 * - the standard **application runtime** context (immutable platform facts, the
 *   server-event subscription facility, and navigation), which is framework
 *   owned and must not be mixed into `C`.
 *
 * It also owns the subscription lifecycle: an application declares the
 * endpoints it observes through {@link ApplicationBase.subscriptions}, and
 * ApplicationBase connects them after mount, dispatches each server-published
 * event to {@link ApplicationBase.onServerEvent}, and closes them on unmount.
 * @template P - The props of the application.
 * @template S - The domain state of the application.
 * @template C - The domain context of the application.
 */
export class ApplicationBase<
  /** The props for the application. */
  P extends object = object,
  /** The state for the application. */
  S extends object = object,
  /** The context for the application. */
  C extends object = Record<string, unknown>,
> extends Component<P & Props, HTMLElement, S & { context: C, runtime: ApplicationRuntime }> {
  static defaultProps: Partial<Props & Component['props']> = {
    ...Component.defaultProps,
    defaultRoute: '/',
  }
  Context: React.Context<C> = React.createContext(this.defaultContext)
  Runtime: React.Context<ApplicationRuntime> = React.createContext(this.defaultRuntime)

  /** Disposers for the connections opened from {@link ApplicationBase.subscriptions}. */
  #subscriptionDisposers: (() => void)[] = []

  get classNames(): Set<string> { return super.classNames.add('application') }
  get defaultContext(): C {
    return {} as C
  }
  /**
   * The default standard runtime context.
   *
   * Built once per application instance from the platform facts embedded in the
   * SPA shell, a shared subscription manager, and framework navigation.
   * @returns The default runtime context.
   */
  get defaultRuntime(): ApplicationRuntime {
    return {
      events: new ServerSubscriptions(event => this.onServerEvent(event)),
      navigate: url => Router.navigate(url),
      runtime: readBasisRuntime(),
    }
  }
  get defaultState(): S & { context: C, runtime: ApplicationRuntime } {
    return {
      ...super.defaultState,
      context: this.defaultContext,
      runtime: this.defaultRuntime,
    }
  }

  get tag() { return 'div' as const }

  constructor(props: P & Props) {
    super(props)

    if (typeof window !== 'undefined') {
      // @ts-expect-error - ApplicationBase is not defined in the global scope
      window.ApplicationBase = this
      // @ts-expect-error - ApplicationContext is not defined in the global scope
      window.ApplicationContext = this.Context
      // @ts-expect-error - BasisRuntimeContext is not defined in the global scope
      window.BasisRuntimeContext = this.Runtime
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
   * Override this getter to declare the server-published endpoints this
   * application observes.
   * @returns The subscription definitions to connect while mounted.
   */
  protected get subscriptions(): readonly SubscriptionDefinition[] {
    return []
  }

  /**
   * Called for each server-published event on a subscribed endpoint.
   *
   * Override this to interpret domain events and update the application context
   * with {@link ApplicationBase.setContext}.
   * @param event - The published event.
   */
  protected onServerEvent(event: ServerEvent): void {
    // Applications override this to interpret the event and update their context.
    void event
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
   * Override to wrap each matched route's root output (for example a single {@link HTMLElement} main
   * landmark with a stable ref).
   * @param outlet - The route component render result
   * @returns Wrapped outlet (default: unchanged)
   */
  protected route(outlet: React.ReactNode): React.ReactNode {
    return outlet
  }

  /** Connects the declared server-event subscriptions alongside mixin mounting. */
  componentDidMount(): void {
    super.componentDidMount()

    for (const definition of this.subscriptions) {
      this.#subscriptionDisposers.push(this.state.runtime.events.subscribe(definition))
    }
  }

  /** Closes the server-event subscriptions alongside mixin unmounting. */
  componentWillUnmount(): void {
    for (const dispose of this.#subscriptionDisposers) dispose()
    this.#subscriptionDisposers = []

    super.componentWillUnmount()
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
          return this.route(<RouteComponent {...params} />)
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
    const { Provider: RuntimeProvider } = this.Runtime
    return (
      <Provider value={this.state.context}>
        <RuntimeProvider value={this.state.runtime}>
          {this.layout(
            <Router>
              {this.renderRoutes()}
            </Router>,
          )}
        </RuntimeProvider>
        <OverlayProvider />
      </Provider>
    )
  }

  /**
   * Sets the domain context.
   * @param updates - The updates to the context
   */
  async setContext(updates: Partial<C>) {
    const context: C = { ...this.state.context, ...updates }
    if (deepEquals(this.state.context, context)) return

    await this.setState(state => ({ ...state, context }))
  }
}
