import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { NavigateEvent } from '../../events/NavigateEvent'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { Component } from '../Component/Component'
import { Dialog } from '../OverlayProvider/Dialog'
import { OverlayProvider } from '../OverlayProvider/OverlayProvider'
import { TextEditor } from '../TextEditor/TextEditor'
import { Router } from './Router'

const CONFIRM_UNSAVED = {
  content: 'You have unsaved changes. Are you sure you want to leave this page?',
  intent: Dialog.Intent.Danger,
  labelCancel: 'Stay',
  labelConfirm: 'Discard changes',
  title: 'Discard unsaved changes?',
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** Route body that is not an Editor but exposes a boolean `dirty` getter for Router guarding. */
class DirtyRoute extends Component<object, HTMLSpanElement> {
  static displayName = 'DirtyRoute'

  content(): React.ReactNode { return 'tracked' }

  get dirty(): boolean { return true }
  get tag(): keyof React.JSX.IntrinsicElements { return 'span' }
}

class RefProbe extends Component<object, HTMLDivElement> {
  static displayName = 'RefProbe'

  content(): React.ReactNode { return null }

  get tag(): keyof React.JSX.IntrinsicElements { return 'div' }
}

class BlockingRoute extends Component<object, HTMLSpanElement> {
  static displayName = 'BlockingRoute'
  content(): React.ReactNode { return 'blocked' }
  onBeforeNavigate = (): boolean => false
  get tag(): keyof React.JSX.IntrinsicElements { return 'span' }
}

class HookOverridesDirtyRoute extends Component<object, HTMLSpanElement> {
  static displayName = 'HookOverridesDirtyRoute'
  content(): React.ReactNode { return 'dirty-hook' }
  get dirty(): boolean { return true }
  onBeforeNavigate = (): boolean => true
  get tag(): keyof React.JSX.IntrinsicElements { return 'span' }
}

/** Clean route with async `onBeforeNavigate` (must not pin render like a dirty leave). */
class AsyncAllowRoute extends Component<object, HTMLSpanElement> {
  static displayName = 'AsyncAllowRoute'
  content(): React.ReactNode { return 'async-home' }
  onBeforeNavigate = async (): Promise<boolean> => true
  get tag(): keyof React.JSX.IntrinsicElements { return 'span' }
}

/**
 * Syncs pathname when tests stub history, so Router sees the same URL the user would after
 * pushState/replaceState.
 * @returns Spies for `pushState` and `replaceState` (caller restores).
 */
function mockHistoryWritesLocation(): { pushState: ReturnType<typeof spyOn>, replaceState: ReturnType<typeof spyOn> } {
  const replaceState = spyOn(window.history, 'replaceState').mockImplementation((state, _title, url) => {
    if (typeof url === 'string' && url.startsWith('/')) {
      window.location.pathname = url
    }
    try {
      Object.defineProperty(window.history, 'state', { configurable: true, value: state, writable: true })
    } catch {
      // ignore environments that cannot redefine history.state
    }
    return undefined
  })
  const pushState = spyOn(window.history, 'pushState').mockImplementation((state, _title, url) => {
    if (typeof url === 'string' && url.startsWith('/')) {
      window.location.pathname = url
    }
    try {
      Object.defineProperty(window.history, 'state', { configurable: true, value: state, writable: true })
    } catch {
      // ignore environments that cannot redefine history.state
    }
    return undefined
  })
  return { pushState, replaceState }
}

/**
 * jsdom does not move the URL on `history.go`; tests that revert denied `popstate` must simulate
 * the follow-up `popstate` the browser would emit.
 * @param resolvePath Maps `history.go` delta to the pathname to apply before dispatching `popstate`.
 * @returns Spy on `window.history.go` (caller should `mockRestore`).
 */
function spyHistoryGoSyncPathname(resolvePath: (delta: number) => string): ReturnType<typeof spyOn> {
  return spyOn(window.history, 'go').mockImplementation((delta: number) => {
    window.location.pathname = resolvePath(Number(delta))
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}

describe('Router', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: {
        href: 'http://example.com/',
        origin: 'http://example.com',
        pathname: '/',
        search: '',
        toString() { return this.href },
      },
      writable: true,
    })
    window.confirm = () => false
  })

  afterEach(async () => {
    if (window.overlayProvider) {
      window.overlayProvider = undefined
    }
    await tick()
  })

  test('matches routes and passes templated params as props', async () => {
    const router = (
      <Router>
        <Router.Route template="/pages/:slug">
          {({ slug }) => (
            <div className="page">
              {slug}
            </div>
          )}
        </Router.Route>
      </Router>
    )

    window.location.pathname = '/pages/foo'
    const { node } = await render<Router>(router)
    expect(node.matches('.page')).toBe(true)
    expect(node.textContent).toBe('foo')
  })

  test('renders route based on current location', async () => {
    const router = (
      <Router>
        <Router.Route template="/:type/:id">
          {({ id, type }) => <div data-id={id} data-type={type} />}
        </Router.Route>
      </Router>
    )

    // Test first route
    window.location.pathname = '/bar/234'
    const rendered = await render<Router>(router)
    expect(rendered.node.outerHTML).toEqual('<div data-id="234" data-type="bar"></div>')
  })

  test('renders different route for different location', async () => {
    const router = (
      <Router>
        <Router.Route template="/:type/:id">
          {({ id, type }) => <div data-id={id} data-type={type} />}
        </Router.Route>
      </Router>
    )

    // Test second route
    window.location.pathname = '/qux/456'
    const rendered = await render<Router>(router)
    expect(rendered.node.outerHTML).toEqual('<div data-id="456" data-type="qux"></div>')
  })

  test('renders null when no route matches', async () => {
    const router = (
      <Router>
        <Router.Route template="/foo">
          <div>Foo</div>
        </Router.Route>
      </Router>
    )

    window.location.pathname = '/non/matching/route'
    const { node } = await render<Router>(router)
    expect(node).toBeNull()
  })

  test('handles query parameters in URL', async () => {
    const router = (
      <Router>
        <Router.Route template="/search">
          <div>Search Results</div>
        </Router.Route>
      </Router>
    )

    window.location.pathname = '/search'
    window.location.search = '?q=test&page=1'
    const { node } = await render<Router>(router)
    expect(node.textContent).toBe('Search Results')
  })

  test('handles root path correctly', async () => {
    const router = (
      <Router>
        <Router.Route template="/">
          <div>Home Page</div>
        </Router.Route>
      </Router>
    )

    window.location.pathname = '/'
    const rendered = await render<Router>(router)
    try {
      expect(rendered.node.textContent).toBe('Home Page')
    } finally {
      rendered.unmount()
    }
  })

  test('Router.navigate updates history and dispatches NavigateEvent when not blocked', async () => {
    const prior = Router.current
    Router.current = null

    const dispatchEvent = spyOn(window, 'dispatchEvent')
    const pushState = spyOn(window.history, 'pushState')

    try {
      const navigated = await Router.navigate('/test/path')

      expect(navigated).toBe(true)
      expect(pushState).toHaveBeenCalledWith(expect.objectContaining({ basisIndex: 1 }), '', '/test/path')
      expect(dispatchEvent).toHaveBeenCalledWith(expect.any(NavigateEvent))
      const event = dispatchEvent.mock.calls.find(([e]) => e instanceof NavigateEvent)?.[0] as NavigateEvent
      expect(event.detail.url).toBe('/test/path')
    } finally {
      dispatchEvent.mockRestore()
      pushState.mockRestore()
      Router.current = prior
    }
  })

  test('prompts and blocks navigation away from a dirty direct route TextEditor', async () => {
    window.location.pathname = '/edit'
    const overlayRendered = await render(<OverlayProvider />)
    const confirm = spyOn(Dialog, 'confirm').mockResolvedValue(false)
    const pushState = spyOn(window.history, 'pushState')
    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/edit">
          <TextEditor initialValue="clean" />
        </Router.Route>
      </Router>,
    )

    try {
      await Simulate.change(rendered.node.querySelector('input') as HTMLInputElement, 'dirty')
      await tick()

      const beforeUnload = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
      window.dispatchEvent(beforeUnload)
      expect(beforeUnload.defaultPrevented).toBe(true)

      const navigated = await Router.navigate('/other')

      expect(navigated).toBe(false)
      expect(confirm).toHaveBeenCalledWith(CONFIRM_UNSAVED)
      expect(pushState).not.toHaveBeenCalled()
    } finally {
      rendered.unmount()
      confirm.mockRestore()
      pushState.mockRestore()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('prompts when a non-Editor route component exposes dirty', async () => {
    window.location.pathname = '/dirty'
    const overlayRendered = await render(<OverlayProvider />)
    const confirm = spyOn(Dialog, 'confirm').mockResolvedValue(false)
    const pushState = spyOn(window.history, 'pushState')
    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/dirty">
          <DirtyRoute />
        </Router.Route>
      </Router>,
    )

    try {
      const navigated = await Router.navigate('/other')

      expect(navigated).toBe(false)
      expect(confirm).toHaveBeenCalledWith(CONFIRM_UNSAVED)
      expect(pushState).not.toHaveBeenCalled()
    } finally {
      rendered.unmount()
      confirm.mockRestore()
      pushState.mockRestore()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('blocks navigation when onBeforeNavigate returns false', async () => {
    window.location.pathname = '/block'
    const pushState = spyOn(window.history, 'pushState')
    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/block">
          <BlockingRoute />
        </Router.Route>
      </Router>,
    )

    try {
      const navigated = await Router.navigate('/away')

      expect(navigated).toBe(false)
      expect(pushState).not.toHaveBeenCalled()
    } finally {
      rendered.unmount()
      pushState.mockRestore()
    }
  })

  test('onBeforeNavigate runs before dirty and can allow navigation without dirty dialog', async () => {
    window.location.pathname = '/hook'
    const overlayRendered = await render(<OverlayProvider />)
    const confirm = spyOn(Dialog, 'confirm')
    const pushState = spyOn(window.history, 'pushState')
    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/hook">
          <HookOverridesDirtyRoute />
        </Router.Route>
      </Router>,
    )

    try {
      const navigated = await Router.navigate('/away')

      expect(navigated).toBe(true)
      expect(confirm).not.toHaveBeenCalled()
      expect(pushState).toHaveBeenCalledWith(expect.objectContaining({ basisIndex: 1 }), '', '/away')
    } finally {
      rendered.unmount()
      confirm.mockRestore()
      pushState.mockRestore()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('preserves an existing callback ref on the direct route element after Router injects its ref', async () => {
    window.location.pathname = '/probe'
    let received: RefProbe | null = null
    const userRef = (instance: RefProbe | null) => {
      received = instance
    }

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/probe">
          <RefProbe ref={userRef} />
        </Router.Route>
      </Router>,
    )

    try {
      expect(received).toBeInstanceOf(RefProbe)
    } finally {
      rendered.unmount()
    }
  })

  test('preserves an existing object ref on the direct route element after Router injects its ref', async () => {
    window.location.pathname = '/probe'
    const userRef = React.createRef<RefProbe>()

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/probe">
          <RefProbe ref={userRef} />
        </Router.Route>
      </Router>,
    )

    try {
      expect(userRef.current).toBeInstanceOf(RefProbe)
    } finally {
      rendered.unmount()
    }
  })

  test('falls back to window.confirm when OverlayProvider is not mounted', async () => {
    window.location.pathname = '/dirty'
    const prior = window.overlayProvider
    window.overlayProvider = undefined

    const confirm = spyOn(window, 'confirm').mockReturnValue(false)

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/dirty">
          <DirtyRoute />
        </Router.Route>
      </Router>,
    )

    try {
      const navigated = await Router.navigate('/away')

      expect(navigated).toBe(false)
      expect(confirm).toHaveBeenCalledWith('You have unsaved changes. Leave this page?')
    } finally {
      confirm.mockRestore()
      window.overlayProvider = prior
      rendered.unmount()
    }
  })

  test('does not swallow Dialog.confirm errors when OverlayProvider is mounted', async () => {
    window.location.pathname = '/edit'
    const overlayRendered = await render(<OverlayProvider />)

    const confirm = spyOn(Dialog, 'confirm').mockRejectedValue(new Error('dialog failed'))

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/edit">
          <DirtyRoute />
        </Router.Route>
      </Router>,
    )

    try {
      await expect(Router.navigate('/away')).rejects.toThrow('dialog failed')
    } finally {
      confirm.mockRestore()
      rendered.unmount()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('allows navigation after confirming dirty direct route TextEditor navigation', async () => {
    window.location.pathname = '/edit'
    const overlayRendered = await render(<OverlayProvider />)
    const confirm = spyOn(Dialog, 'confirm').mockResolvedValue(true)
    const pushState = spyOn(window.history, 'pushState')
    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/edit">
          {() => <TextEditor initialValue="clean" />}
        </Router.Route>
      </Router>,
    )

    try {
      await Simulate.change(rendered.node.querySelector('input') as HTMLInputElement, 'dirty')
      await tick()

      const navigated = await Router.navigate('/other')

      expect(navigated).toBe(true)
      expect(confirm).toHaveBeenCalled()
      expect(pushState).toHaveBeenCalledWith(expect.objectContaining({ basisIndex: 1 }), '', '/other')
    } finally {
      rendered.unmount()
      confirm.mockRestore()
      pushState.mockRestore()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('popstate dirty cancel restores the current URL with the inverse history index delta', async () => {
    window.location.pathname = '/dirty'
    const { pushState, replaceState } = mockHistoryWritesLocation()
    const overlayRendered = await render(<OverlayProvider />)
    const confirm = spyOn(Dialog, 'confirm').mockResolvedValue(false)

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/dirty">
          <DirtyRoute />
        </Router.Route>
        <Router.Route template="/away">
          <span className="away">away</span>
        </Router.Route>
      </Router>,
    )

    const go = spyHistoryGoSyncPathname(delta => (delta === 1 ? '/dirty' : '/away'))
    try {
      window.history.replaceState({ basisIndex: -1 }, '', '/away')
      window.dispatchEvent(new PopStateEvent('popstate'))
      await tick()
      await tick()

      expect(confirm).toHaveBeenCalledWith(CONFIRM_UNSAVED)
      expect(go).toHaveBeenCalledWith(1)
      expect(pushState).not.toHaveBeenCalled()
      expect(replaceState).toHaveBeenCalled()
      expect(window.location.pathname).toBe('/dirty')
      expect(rendered.node.textContent).toBe('tracked')
    } finally {
      go.mockRestore()
      confirm.mockRestore()
      pushState.mockRestore()
      replaceState.mockRestore()
      rendered.unmount()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('popstate dirty cancel keeps editor state while history.go corrective popstate is pending', async () => {
    window.location.pathname = '/edit'
    const { pushState, replaceState } = mockHistoryWritesLocation()
    const overlayRendered = await render(<OverlayProvider />)
    const confirm = spyOn(Dialog, 'confirm').mockResolvedValue(false)
    let pendingDelta: number | undefined
    const go = spyOn(window.history, 'go').mockImplementation((delta: number) => {
      pendingDelta = delta
    })

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/edit">
          <TextEditor initialValue="clean" />
        </Router.Route>
        <Router.Route template="/away">
          <span className="away">away</span>
        </Router.Route>
      </Router>,
    )

    try {
      await Simulate.change(rendered.node.querySelector('input') as HTMLInputElement, 'dirty')
      await tick()

      window.history.replaceState({ basisIndex: 1 }, '', '/away')
      window.dispatchEvent(new PopStateEvent('popstate'))
      await tick()
      await tick()

      expect(confirm).toHaveBeenCalledWith(CONFIRM_UNSAVED)
      expect(go).toHaveBeenCalledWith(-1)
      expect(pendingDelta).toBe(-1)
      expect(pushState).not.toHaveBeenCalled()
      expect(window.location.pathname).toBe('/away')
      expect(rendered.node.querySelector('input')?.value).toBe('dirty')

      window.location.pathname = '/edit'
      window.dispatchEvent(new PopStateEvent('popstate'))
      await tick()

      expect(rendered.node.querySelector('input')?.value).toBe('dirty')
    } finally {
      go.mockRestore()
      confirm.mockRestore()
      pushState.mockRestore()
      replaceState.mockRestore()
      rendered.unmount()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('popstate with dirty route confirms and commits navigation', async () => {
    window.location.pathname = '/dirty'
    const { pushState, replaceState } = mockHistoryWritesLocation()
    const overlayRendered = await render(<OverlayProvider />)
    const confirm = spyOn(Dialog, 'confirm').mockResolvedValue(true)

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/dirty">
          <DirtyRoute />
        </Router.Route>
        <Router.Route template="/away">
          <span className="away">away</span>
        </Router.Route>
      </Router>,
    )

    try {
      window.location.pathname = '/away'
      window.dispatchEvent(new PopStateEvent('popstate'))
      await tick()
      await tick()

      expect(confirm).toHaveBeenCalled()
      expect(pushState).not.toHaveBeenCalled()
      expect(window.location.pathname).toBe('/away')
      expect(rendered.node.className).toContain('away')
    } finally {
      confirm.mockRestore()
      pushState.mockRestore()
      replaceState.mockRestore()
      rendered.unmount()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('popstate onto clean TextEditor does not call Dialog.confirm before the editor mounts', async () => {
    window.location.pathname = '/home'
    const overlayRendered = await render(<OverlayProvider />)
    const confirm = spyOn(Dialog, 'confirm')
    const { pushState, replaceState } = mockHistoryWritesLocation()

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/home">
          <span className="home-page">home</span>
        </Router.Route>
        <Router.Route template="/edit">
          <TextEditor initialValue="clean" />
        </Router.Route>
      </Router>,
    )

    try {
      window.location.pathname = '/edit'
      window.dispatchEvent(new PopStateEvent('popstate'))
      await tick()
      await tick()

      expect(confirm).not.toHaveBeenCalled()
      expect(rendered.node.querySelector('input')).not.toBeNull()
    } finally {
      confirm.mockRestore()
      pushState.mockRestore()
      replaceState.mockRestore()
      rendered.unmount()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('popstate: pending onBeforeNavigate promise must not block destination route from mounting', async () => {
    let release!: (value: boolean) => void
    const pending = new Promise<boolean>(resolve => {
      release = resolve
    })

    class DeferredNavLocal extends Component<object, HTMLSpanElement> {
      static displayName = 'DeferredNavLocal'
      content(): React.ReactNode { return 'wait' }
      onBeforeNavigate = (): Promise<boolean> => pending
      get tag(): keyof React.JSX.IntrinsicElements { return 'span' }
    }

    window.location.pathname = '/def'
    const overlayRendered = await render(<OverlayProvider />)
    const confirm = spyOn(Dialog, 'confirm')
    const { pushState, replaceState } = mockHistoryWritesLocation()

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/def">
          <DeferredNavLocal />
        </Router.Route>
        <Router.Route template="/edit3">
          <TextEditor initialValue="y" />
        </Router.Route>
      </Router>,
    )

    try {
      window.location.pathname = '/edit3'
      window.dispatchEvent(new PopStateEvent('popstate'))
      await tick()

      expect(confirm).not.toHaveBeenCalled()
      expect(rendered.node.querySelector('input')).not.toBeNull()

      release(true)
      await tick()
    } finally {
      confirm.mockRestore()
      pushState.mockRestore()
      replaceState.mockRestore()
      rendered.unmount()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('popstate from clean async onBeforeNavigate route still reaches TextEditor without Dialog.confirm', async () => {
    window.location.pathname = '/async-home'
    const overlayRendered = await render(<OverlayProvider />)
    const confirm = spyOn(Dialog, 'confirm')
    const { pushState, replaceState } = mockHistoryWritesLocation()

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/async-home">
          <AsyncAllowRoute />
        </Router.Route>
        <Router.Route template="/edit2">
          <TextEditor initialValue="x" />
        </Router.Route>
      </Router>,
    )

    try {
      window.location.pathname = '/edit2'
      window.dispatchEvent(new PopStateEvent('popstate'))
      await tick()
      await tick()
      await tick()

      expect(confirm).not.toHaveBeenCalled()
      expect(rendered.node.querySelector('input')).not.toBeNull()
    } finally {
      confirm.mockRestore()
      pushState.mockRestore()
      replaceState.mockRestore()
      rendered.unmount()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('popstate on a clean route updates the rendered page without extra history writes', async () => {
    window.location.pathname = '/a'
    const { pushState, replaceState } = mockHistoryWritesLocation()

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/a">
          <span className="a-page">a</span>
        </Router.Route>
        <Router.Route template="/b">
          <span className="b-page">b</span>
        </Router.Route>
      </Router>,
    )

    try {
      replaceState.mockClear()
      pushState.mockClear()

      window.location.pathname = '/b'
      window.dispatchEvent(new PopStateEvent('popstate'))
      await tick()

      expect(replaceState).not.toHaveBeenCalled()
      expect(pushState).not.toHaveBeenCalled()
      expect(rendered.node.className).toContain('b-page')
    } finally {
      pushState.mockRestore()
      replaceState.mockRestore()
      rendered.unmount()
    }
  })

  test('popstate with path unchanged (hash-only) does not run dirty confirm', async () => {
    window.location.pathname = '/same'
    window.location.hash = '#one'
    const overlayRendered = await render(<OverlayProvider />)
    const confirm = spyOn(Dialog, 'confirm')

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/same">
          <DirtyRoute />
        </Router.Route>
      </Router>,
    )

    try {
      window.location.hash = '#two'
      window.dispatchEvent(new PopStateEvent('popstate'))
      await tick()

      expect(confirm).not.toHaveBeenCalled()
    } finally {
      confirm.mockRestore()
      rendered.unmount()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('beforeunload sets returnValue when route is dirty', async () => {
    window.location.pathname = '/edit'
    const overlayRendered = await render(<OverlayProvider />)
    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/edit">
          <TextEditor initialValue="clean" />
        </Router.Route>
      </Router>,
    )

    try {
      await Simulate.change(rendered.node.querySelector('input') as HTMLInputElement, 'dirty')
      await tick()

      const beforeUnload = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
      window.dispatchEvent(beforeUnload)
      expect(beforeUnload.defaultPrevented).toBe(true)
      expect(beforeUnload.returnValue).toBe('')
    } finally {
      rendered.unmount()
      overlayRendered.unmount()
      await tick()
    }
  })

  test('beforeunload does not block when route is not guarded as dirty', async () => {
    window.location.pathname = '/clean'
    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/clean">
          <span>ok</span>
        </Router.Route>
      </Router>,
    )

    try {
      const beforeUnload = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
      window.dispatchEvent(beforeUnload)
      expect(beforeUnload.defaultPrevented).toBe(false)
    } finally {
      rendered.unmount()
    }
  })

  test('popstate with onBeforeNavigate false reverts without Dialog.confirm', async () => {
    window.location.pathname = '/block'
    const { pushState, replaceState } = mockHistoryWritesLocation()
    const overlayRendered = await render(<OverlayProvider />)
    const confirm = spyOn(Dialog, 'confirm')

    const rendered = await render<Router>(
      <Router>
        <Router.Route template="/block">
          <BlockingRoute />
        </Router.Route>
        <Router.Route template="/away">
          <span className="away">away</span>
        </Router.Route>
      </Router>,
    )

    const go = spyHistoryGoSyncPathname(delta => (delta === 1 ? '/block' : '/away'))
    try {
      window.history.replaceState({ basisIndex: -1 }, '', '/away')
      window.dispatchEvent(new PopStateEvent('popstate'))
      await tick()
      await tick()

      expect(confirm).not.toHaveBeenCalled()
      expect(go).toHaveBeenCalledWith(1)
      expect(pushState).not.toHaveBeenCalled()
      expect(replaceState).toHaveBeenCalled()
      expect(window.location.pathname).toBe('/block')
    } finally {
      go.mockRestore()
      confirm.mockRestore()
      pushState.mockRestore()
      replaceState.mockRestore()
      rendered.unmount()
      overlayRendered.unmount()
      await tick()
    }
  })
})
