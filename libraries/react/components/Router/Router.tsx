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

/** Session history state key recording SPA pathname+search before each Router-driven push. */
const HISTORY_BASIS_FROM = 'basisFrom'

/**
 * If `history.go` does not emit `popstate`, clear {@link Router.#popstateIgnoreOne} so later events
 * are not swallowed.
 */
const POPSTATE_IGNORE_FALLBACK_MS = 250

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
    const basisFrom = Router.windowURL
    window.history.pushState({ [HISTORY_BASIS_FROM]: basisFrom }, '', url)
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

  #lastAcceptedPathSearch = ''
  /**
   * While set, route matching uses this path+search instead of the real location so the previous
   * route stays mounted during an async popstate guard (dialog).
   */
  #pendingPopstateRenderPathSearch: string | null = null
  /** Cleared when the deferred `popstate` from {@link Router.#revertDeniedPopNavigation} never arrives. */
  #popstateIgnoreFallbackTimeoutId: ReturnType<typeof setTimeout> | null = null
  /** Skips one `popstate` emitted by `history.go` after a denied navigation revert. */
  #popstateIgnoreOne = false
  #routeComponent: RouteComponent | null = null

  async canNavigate(url: string): Promise<boolean> {
    return this.#canNavigateWithRoute(url, this.#routeComponent)
  }

  /**
   * Runs leave guards for the given route snapshot (used by popstate so the leaving page does not
   * change mid-await when the address bar already matches the destination).
   * @param url - Destination pathname+search being navigated to.
   * @param route - Leaving route instance captured before any intermediate re-render.
   * @returns Whether navigation may proceed.
   */
  async #canNavigateWithRoute(url: string, route: RouteComponent | null): Promise<boolean> {
    if (!route) return true

    if ('onBeforeNavigate' in route && typeof route.onBeforeNavigate === 'function') {
      return await route.onBeforeNavigate(url)
    }

    if ('dirty' in route && route.dirty) {
      return await this.#confirmDirtyNavigation()
    }

    return true
  }

  /**
   * Pin route matching to the last accepted URL only while awaiting a dirty-leave dialog.
   * @param route - Leaving route instance.
   * @returns True when the leaving route is dirty and must stay mounted during the discard prompt.
   */
  #routeNeedsRenderPinWhileGuarding(route: RouteComponent | null): boolean {
    return !!route && 'dirty' in route && route.dirty
  }

  componentDidMount(): void {
    Router.current = this
    this.#lastAcceptedPathSearch = this.props.url ?? Router.windowURL
    window.addEventListener(NavigateEvent.name, this.#handleNavigateEvent)
    window.addEventListener('popstate', this.#handlePopstate)
    window.addEventListener('beforeunload', this.#handleBeforeUnload)
  }

  componentWillUnmount(): void {
    if (Router.current === this) Router.current = null

    this.#clearPopstateIgnoreFallbackTimeout()
    window.removeEventListener(NavigateEvent.name, this.#handleNavigateEvent)
    window.removeEventListener('popstate', this.#handlePopstate)
    window.removeEventListener('beforeunload', this.#handleBeforeUnload)
  }

  #handleNavigateEvent = (): void => {
    this.#lastAcceptedPathSearch = Router.windowURL
    this.forceUpdate()
    if (typeof window !== 'undefined') {
      Router.#handleNavigationScrolling(window.location.href)
    }
  }

  #clearPopstateIgnoreFallbackTimeout(): void {
    if (this.#popstateIgnoreFallbackTimeoutId !== null) {
      clearTimeout(this.#popstateIgnoreFallbackTimeoutId)
      this.#popstateIgnoreFallbackTimeoutId = null
    }
  }

  #handlePopstate = async (): Promise<void> => {
    if (Router.serverSide) return

    if (this.#popstateIgnoreOne) {
      this.#clearPopstateIgnoreFallbackTimeout()
      this.#popstateIgnoreOne = false
      this.#lastAcceptedPathSearch = Router.windowURL
      this.#pendingPopstateRenderPathSearch = null
      this.forceUpdate()
      Router.#handleNavigationScrolling(window.location.href)
      return
    }

    const attempted = Router.windowURL
    if (attempted === this.#lastAcceptedPathSearch) {
      this.forceUpdate()
      Router.#handleNavigationScrolling(window.location.href)
      return
    }

    const leaving = this.#routeComponent
    if (attempted !== this.#lastAcceptedPathSearch) {
      if (this.#routeNeedsRenderPinWhileGuarding(leaving)) {
        this.#pendingPopstateRenderPathSearch = this.#lastAcceptedPathSearch
      }
      // Commit destination URL matching before awaiting leave guards (dirty leave keeps pin above).
      this.forceUpdate()
    }

    let allowed: boolean
    try {
      allowed = await this.#canNavigateWithRoute(attempted, leaving)
    } catch (error) {
      this.#pendingPopstateRenderPathSearch = null
      this.#revertDeniedPopNavigation()
      this.forceUpdate()
      throw error
    }

    if (!allowed) {
      this.#revertDeniedPopNavigation()
      this.#pendingPopstateRenderPathSearch = null
      this.forceUpdate()
      return
    }

    this.#pendingPopstateRenderPathSearch = null
    this.#lastAcceptedPathSearch = attempted
    if (Router.windowURL !== attempted) {
      Router.#commitNavigation(attempted)
    } else {
      this.forceUpdate()
      Router.#handleNavigationScrolling(window.location.href)
    }
  }

  /**
   * Undo a disallowed browser history step without `pushState`, which would drop forward entries.
   * Uses `history.state[HISTORY_BASIS_FROM]` from {@link Router.#commitNavigation} to pick `go(-1)` vs `go(1)`.
   */
  #revertDeniedPopNavigation(): void {
    if (Router.windowURL === this.#lastAcceptedPathSearch) return

    const raw = window.history.state as Record<string, unknown> | null
    const basisFrom = typeof raw?.[HISTORY_BASIS_FROM] === 'string'
      ? raw[HISTORY_BASIS_FROM] as string
      : null
    const delta = basisFrom !== null && basisFrom === this.#lastAcceptedPathSearch ? -1 : 1

    this.#clearPopstateIgnoreFallbackTimeout()
    this.#popstateIgnoreOne = true
    window.history.go(delta)

    this.#popstateIgnoreFallbackTimeoutId = setTimeout(() => {
      this.#popstateIgnoreFallbackTimeoutId = null
      if (!this.#popstateIgnoreOne) return
      this.#popstateIgnoreOne = false
      this.#lastAcceptedPathSearch = Router.windowURL
      this.#pendingPopstateRenderPathSearch = null
      this.forceUpdate()
    }, POPSTATE_IGNORE_FALLBACK_MS)
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
    const currentURL = this.#pendingPopstateRenderPathSearch ??
      this.props.url ??
      Router.windowURL
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
