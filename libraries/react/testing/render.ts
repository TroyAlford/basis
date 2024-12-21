import * as React from 'react'
import * as ReactDOM from 'react-dom'

type PropsOf<C> = C extends React.ReactElement<infer P> ? P : unknown
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

interface RenderResult<
  C extends React.Component | React.FunctionComponent = React.Component,
  N extends Element | Element[] = HTMLElement,
> {
  find: <I>(ctor: Ctor<I> | string) => I | null,
  findAll: <I>(ctor: Ctor<I>) => I[],
  instance: C,
  node: N,
  root: HTMLElement,
  unmount: () => void,
  update: (updatedJSX: JSX.Element) => RenderResult<C, N>,
}

/**
 * Render a JSX element to the DOM
 * @param jsx the JSX element to render
 * @param target the target element to render the JSX element to
 * @returns the rendered JSX element
 */
export function render<
  C extends React.Component | React.FunctionComponent = React.Component,
  N extends Element | Element[] = HTMLElement,
>(jsx: JSX.Element, target?: HTMLElement): RenderResult<C, N> {
  const root = target ?? document.createElement('div')

  const instance = ReactDOM.render<PropsOf<C>>(jsx, root) as unknown as C
  const unmount = () => ReactDOM.unmountComponentAtNode(root)

  /**
   * Search for a component instance in the rendered tree
   * @param ctor the constructor of the component to search for
   * @yields the component instance
   * @returns the component instance
   * @example
   * const { find } = render(<App />)
   * const app = find(App)
   * console.log(app)
   */
  function* search<I>(ctor: Ctor<I> | string) {
    // @ts-expect-error - accessing private/hidden methods
    const rootNode = instance?._reactInternals ?? instance?._reactInternalFiber
    const queue: Fiber[] = [rootNode]

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

  return {
    find: <I>(ctor: Ctor<I> | string) => search<I>(ctor).next()?.value ?? null,
    findAll: <I>(ctor: Ctor<I>): I[] => Array.from(search<I>(ctor)),
    instance,
    node: (
      root.children.length > 1
        ? Array.from(root.children)
        : root.children.item(0)
    ) as N,
    root,
    unmount,
    update: (updatedJSX: JSX.Element = React.cloneElement(jsx, jsx.props)) => render<C, N>(updatedJSX, root)
    ,
  }
}
