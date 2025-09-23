import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import { noop } from '@basis/utilities'

type Class<T> = new (...args: unknown[]) => T
type Fn<T> = (...args: unknown[]) => T
type Ctor<T> = Class<T> | Fn<T>
interface Fiber {
  child?: Fiber,
  children?: Fiber[],
  memoizedProps?: object,
  return?: Fiber,
  sibling?: Fiber,
  stateNode?: object,
  type?: Ctor<unknown> | string,
}

interface Rendered<
  C extends React.Component | React.FunctionComponent = React.Component,
  N extends Element | Element[] = HTMLElement,
> {
  /**
   * Search for a component instance in the rendered tree
   * @param ctor Component (Button, App, etc) or HTML element ('div', 'span') to search for
   * @returns the first matching component instance
   */
  find: <I>(ctor: Ctor<I> | string) => Promise<I | null>,
  /**
   * Search for all component instances in the rendered tree
   * @param ctor Component (Button, App, etc) or HTML element ('div', 'span') to search for
   * @returns all matching component instances
   */
  findAll: <I>(ctor: Ctor<I>) => Promise<I[]>,
  /**
   * For class components, the instance of the components.
   * For function components, which have no instance, this will return null.
   */
  instance: C,
  /** The rendered DOM node. */
  node: N,
  /** The root DOM element/container */
  root: HTMLElement,
  /** Unmounts the component and cleans up the DOM/root */
  unmount: () => void,
  /**
   * Updates the rendered component tree with new JSX. Resolves
   * only after React's update is flushed and `componentDidUpdate`
   * fires on the wrapper (guaranteed by always-true shouldComponentUpdate).
   *
   * If called multiple times in a row, all pending calls will resolve after
   * the *next* update is flushed.
   * @param update The new JSX tree to render (default: shallow clone of previous).
   * @param timeout The timeout in milliseconds to wait for the update to flush.
   * @returns      Promise resolving to the same Rendered helper after update is flushed.
   */
  update: (update?: React.ReactElement, timeout?: number) => Promise<Rendered<C, N>>,
}

/**
 * @template C
 *
 * This class-component wrapper is designed for test infrastructure.
 * It guarantees a "flush signal" for both mounting and every update.
 *
 * ## Why this design?
 * - **Always re-renders:** By returning `true` from shouldComponentUpdate,
 *   we force React to *never* skip an update on this wrapper,
 *   even if the children/props are deeply equal. This means:
 *     - `componentDidUpdate` always fires after *every* `.render()` call,
 *       making the update promise robust.
 * - **Reliable promise resolution:** This is key for async `update()` logic:
 *   you never have to deal with React optimizations skipping updates, so
 *   your helpers never hang or need microtask/timeouts to "unstick".
 * - **Children instance wiring:** Also provides a `ref` to the child.
 * ref A ref to the wrapped child instance.
 * onMounted Callback fired after initial mount (resolves render()).
 * onUpdated Callback fired after any update (resolves update()).
 * onUnmounted Callback fired before unmount (cleans up).
 */
class Mounter<C> extends React.Component<{
  childRef: React.RefObject<C>,
  children: React.ReactElement<{ ref?: React.RefObject<C> }>,
  onMounted: (instance: React.RefObject<C>) => void,
  onUnmounted: (instance: React.RefObject<C>) => void,
}, { children: React.ReactNode, error: unknown }> {
  static defaultProps = {
    onMounted: noop,
    onUnmounted: noop,
  }

  static getDerivedStateFromError(error: unknown) { return { error } }

  state = {
    children: this.props.children,
    error: undefined,
  }

  onUpdated: (ref: React.RefObject<C>) => void = noop

  /**
   * Fires after first mount; resolves the initial render() promise.
   * @returns void
   */
  componentDidMount = () => this.props.onMounted(this.props.childRef)

  /**
   * Fires after *every* update (including no-op prop updates).
   * This is the core "flush signal" for async `update()`.
   * @returns void
   */
  componentDidUpdate = () => this.onUpdated(this.props.childRef)

  /**
   * Fires before unmount; can be used for cleanup (e.g., test DOM).
   * @returns void
   */
  componentWillUnmount = () => this.props.onUnmounted(this.props.childRef)

  /**
   * Always returns true—forces React to *never* skip an update.
   * This ensures `componentDidUpdate` always fires, and that
   * our update promise is always resolved—no async race conditions.
   *
   * See: https://react.dev/reference/react/Component#shouldcomponentupdate
   *      https://github.com/facebook/react/issues/12502
   * @returns true
   */
  shouldComponentUpdate = () => true

  /**
   * Catches errors in child components and triggers the update cycle.
   * This ensures that error states are properly flushed in React 19.
   */
  componentDidCatch = () => {
    this.onUpdated(this.props.childRef)
  }

  /**
   * Clones the child and passes down a ref so we can access the child instance.
   * @returns the cloned child with a ref to the instance
   */
  render = () => (
    !this.state.error
      ? React.cloneElement(this.state.children, { ref: this.props.childRef })
      : null
  )
}

/**
 * Render a JSX element to the DOM
 * @param children the JSX element to render
 * @param target the target element to render the JSX element to (optional)
 * @param root the root to use for rendering (optional)
 * @returns the rendered JSX element
 */
export async function render<
  C extends React.Component | React.FunctionComponent = React.Component,
  N extends Element | Element[] = HTMLElement,
>(children: React.ReactElement, target?: HTMLElement, root?: ReactDOM.Root): Promise<Rendered<C, N>> {
  const rootElement = target ?? document.createElement('div')
  const rootDOM = root ?? ReactDOM.createRoot(rootElement)
  const mounterRef = React.createRef<Mounter<C>>()
  const childRef = React.createRef<C>()

  // Establish promise/callback for the initial mount
  let onMounted: (value: React.RefObject<C>) => void
  const onMountedPromise = new Promise<React.RefObject<C>>(resolve => { onMounted = resolve })

  // Establish promise/callback for the unmount
  let onUnmounted: (value: React.RefObject<C>) => void
  new Promise<React.Ref<C>>(resolve => { onUnmounted = resolve })
    .then(() => rootDOM.unmount())

  // Establish promise/callback for the updates.
  let onUpdated: () => void
  let hasUpdated = false
  /*
   * Shared "update flush" promise; reused for all pending update() calls
   * until the next flush, after which a new one is created.
   */
  const onUpdatedPromise = new Promise<void>(resolve => { onUpdated = resolve })
    .then(() => { hasUpdated = true })

  // Track the most recent children for bare update() calls
  let currentChildren = children

  rootDOM.render(
    <Mounter<C>
      ref={mounterRef}
      childRef={childRef}
      children={children}
      onMounted={onMounted}
      onUnmounted={onUnmounted}
    />,
  )

  // Wait for the initial mount to complete
  await onMountedPromise

  // Set the onUpdated callback on the mounter ref
  mounterRef.current.onUpdated = onUpdated

  /**
   * Search for a component instance in the rendered tree
   * @param ctor The constructor or element tag to search for
   * @yields the next matching component instance
   * @returns the last matching component instance
   * @example
   * const { find } = render(<App />)
   * const app = find(App)
   * console.log(app)
   */
  function* search<I>(ctor: Ctor<I> | string) {
    const instance = childRef.current
    if (!instance) return null

    const fiberKey = Object.keys(instance).find(k => k.startsWith('__reactFiber$'))
    const fiber = fiberKey ? instance[fiberKey] : undefined
    const queue: Fiber[] = [fiber]

    while (queue.length) {
      const node = queue.shift()

      if (node?.type === ctor && node?.return !== null) {
        yield (node?.stateNode ?? { props: node?.memoizedProps }) as I
      }

      if (node?.sibling) queue.push(node.sibling)
      if (node?.child) queue.push(node.child)
    }

    return null
  }

  const result: Rendered<C, N> = {
    async find<I>(ctor: Ctor<I> | string) {
      await onMountedPromise
      return search<I>(ctor).next()?.value ?? null
    },
    async findAll<I>(ctor: Ctor<I>): Promise<I[]> {
      await onMountedPromise
      return Promise.all(Array.from(search<I>(ctor)))
    },
    get instance() { return childRef.current },
    get node(): N {
      return rootElement.children.length > 1
        ? Array.from(rootElement.children) as N
        : rootElement.children.item(0) as N
    },
    root: rootElement,
    unmount: () => onUnmounted(childRef),
    update: async (
      update = currentChildren,
      timeout = 50,
    ) => {
      // If no update provided, just wait for the current state to flush
      if (update === currentChildren) {
        return await Promise.resolve(result)
      }

      // Update the current children reference
      currentChildren = update

      let updatePromise: Promise<void> = onUpdatedPromise
      if (hasUpdated) {
        hasUpdated = false
        updatePromise = new Promise<void>(resolve => { onUpdated = resolve })
          .then(() => { hasUpdated = true })
        mounterRef.current.onUpdated = onUpdated
      }

      mounterRef.current.setState({ children: update })

      let finished = false
      updatePromise.then(() => { finished = true })

      await Promise.race([
        updatePromise,
        new Promise<void>(resolve => setTimeout(() => {
          if (!finished) resolve()
        }, timeout)),
      ])

      return result
    },
  }
  return result
}
