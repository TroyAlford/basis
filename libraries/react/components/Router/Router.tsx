import * as React from 'react'
import { parseTemplateURI } from '@basis/utilities'
import { NavigateEvent } from '../../events/NavigateEvent'
import { Component } from '../Component/Component'
import { Dialog } from '../OverlayProvider/Dialog'
import { Link } from './Link'
import { Location } from './Location'
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

interface Editable {
  readonly dirty: boolean,
}

interface NavigablePage {
  onBeforeNavigate?: (url: string) => boolean | Promise<boolean>,
}

type RouteComponent = Editable | NavigablePage

const isRouteComponent = (value: unknown): value is RouteComponent => (
  !!value && typeof value === 'object'
)

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
  static current: Router | null = null

  static Link = Link
  static Route = Route
  static Switch = Switch
  static Redirect = Redirect

  static async navigate(url: string): Promise<boolean> {
    const router = Router.current
    if (router !== null && !await router.canNavigate(url)) return false

    Router.#commitNavigation(url)
    return true
  }

  /**
   * Updates history, scroll position, and dispatches {@link NavigateEvent}.
   * Route guards run in {@link Router.navigate}; this performs the actual transition.
   * @param url The URL to navigate to
   */
  static #commitNavigation(url: string): void {
    window.history.pushState({}, '', url)
    Router.#handleNavigationScrolling(url)
    window.dispatchEvent(new NavigateEvent(url))
  }

  /**
   * Scroll after URL change (hash target or document top).
   * Used after navigation and when reacting to history updates (without dispatching).
   * @param url The URL to handle scrolling for
   */
  static #handleNavigationScrolling(url: string): void {
    const urlObj = new URL(url, window.location.origin)
    const hash = urlObj.hash

    if (hash) {
      const targetId = hash.slice(1)
      const targetElement = document.getElementById(targetId)
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth' })
      }
    } else {
      window.scrollTo({ top: 0 })
    }
  }

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

  #routeComponent: RouteComponent | null = null

  async canNavigate(url: string): Promise<boolean> {
    const route = this.#routeComponent
    if (!route) return true

    if ('onBeforeNavigate' in route && typeof route.onBeforeNavigate === 'function') {
      return await route.onBeforeNavigate(url)
    }

    if ('dirty' in route && route.dirty) {
      return await this.#confirmDirtyNavigation()
    }

    return true
  }

  componentDidMount(): void {
    Router.current = this
    window.addEventListener(NavigateEvent.name, this.#handleUpdate)
    window.addEventListener('popstate', this.#handleUpdate)
    window.addEventListener('beforeunload', this.#handleBeforeUnload)
  }

  componentWillUnmount(): void {
    if (Router.current === this) Router.current = null

    window.removeEventListener(NavigateEvent.name, this.#handleUpdate)
    window.removeEventListener('popstate', this.#handleUpdate)
    window.removeEventListener('beforeunload', this.#handleBeforeUnload)
  }

  #handleUpdate = (): void => {
    this.forceUpdate()
    if (typeof window !== 'undefined') {
      Router.#handleNavigationScrolling(window.location.href)
    }
  }

  #confirmDirtyNavigation = async (): Promise<boolean> => {
    if (typeof window !== 'undefined' && window.overlayProvider) {
      return await Dialog.confirm({
        content: 'You have unsaved changes. Are you sure you want to leave this page?',
        intent: Dialog.Intent.Danger,
        labelCancel: 'Stay',
        labelConfirm: 'Discard changes',
        title: 'Discard unsaved changes?',
      })
    }

    return window.confirm('You have unsaved changes. Leave this page?')
  }

  #componentRef(node: React.ReactElement<Record<string, unknown>>): React.RefCallback<unknown> {
    const previousRef = (node.props.ref ??
      (node as React.ReactElement & { ref?: React.Ref<unknown> }).ref) as React.Ref<unknown> | undefined

    return value => {
      this.#routeComponent = isRouteComponent(value) ? value : null

      if (typeof previousRef === 'function') previousRef(value)
      else if (previousRef && typeof previousRef === 'object') {
        (previousRef as React.MutableRefObject<unknown>).current = value
      }
    }
  }

  #handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    const route = this.#routeComponent
    if (!route || !('dirty' in route) || !(route as Editable).dirty) return

    event.preventDefault()
    event.returnValue = ''
  }

  #renderGuardedRoute(node: React.ReactNode): React.ReactNode {
    if (!React.isValidElement(node)) return node
    if (typeof node.type === 'string') return node

    return React.cloneElement(node, {
      ref: this.#componentRef(node as React.ReactElement<Record<string, unknown>>),
    } as Partial<typeof node.props>)
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
      if (typeof children === 'function') return this.#renderGuardedRoute(children(params))
      if (React.isValidElement(children)) return this.#renderGuardedRoute(children)
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
