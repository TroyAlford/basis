import type { ComponentType } from 'react'
import * as React from 'react'
import { classNames, deepEquals, kebabCase, noop } from '@basis/utilities'
import type { Mixin } from '../../types/Mixin'
import { filterByPrefix } from '../../utilities/filterByPrefix'
import { prefixObject } from '../../utilities/prefixObject'

type Tag<P = object> =
  | keyof React.JSX.IntrinsicElements
  | ComponentType<P>

/** Props for the Component class. */
interface TProps<E extends Element = HTMLDivElement> {
  /** The children of the component. */
  children?: React.ReactNode,
  /** Optional class name(s) to output on the component's root element. */
  className?:
  | string
  | Set<string>
  | Record<string, boolean | (() => boolean)>,
  /** An optional ref to the component's root element. */
  nodeRef?: React.RefObject<E>,
  /** Callback function called when a key is pressed while the component has focus. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void,
  /** The style of the component. */
  style?: React.CSSProperties,
  /** The name of the theme to use for the component. */
  theme?: string,
}

type P<E extends Element, T> = TProps<E> & T

/**
 * The abstract base class for all components in the @basis/react package.
 * @template Props The props of the component.
 * @template Element The root element type of the component.
 * @template State The state of the component.
 */
export abstract class Component<
  /** The props of the component. */
  Props = object,
  /** The root element type of the component. */
  Element extends HTMLElement | SVGElement = HTMLDivElement,
  /** The state of the component. */
  State = object,
> extends React.Component<P<Element, Props>, State> {
  static get mixins(): Set<Mixin> { return new Set() }
  static get defaultProps(): P<HTMLElement, TProps> {
    return {
      onKeyDown: () => undefined,
      theme: undefined,
      ...Array.from(this.mixins).reduce((props, mixin) => ({
        ...props, ...mixin.defaultProps,
      }), {}),
    }
  }

  /**
   * Getter for attributes.
   * @returns a React.HTMLAttributes<Element> object
   * @example get attributes() { return { tabIndex: 0 } }
   */
  get attributes() {
    return {
      'data-theme': this.props.theme,
      'style': this.props.style,
      ...prefixObject('aria-', filterByPrefix('aria-', this.props)),
      ...prefixObject('data-', filterByPrefix('data-', this.props)),
      ...this.mixins.reduce((attributes, mixin) => ({
        ...attributes, ...mixin.attributes?.(this.props),
      }), {}),
    }
  }

  /**
   * Getter for class names.
   * @returns a Set<string> of class names. Component automatically adds a kebab-cased version of the
   * component's name (using `displayName` or `name`) to the set.
   */
  get classNames(): Set<string> {
    return new Set<string>()
      // @ts-expect-error - displayName is valid in React components, but not typed
      .add(kebabCase(this.constructor.displayName ?? this.constructor.name))
      .add('component')
  }

  /**
   * Getter for the initial state of the component.
   * @returns The initial state of the component.
   */
  get defaultState(): State { return {} as State }
  readonly state = this.defaultState

  #nodeRef = React.createRef<Element>()
  get nodeRef(): React.RefObject<Element> {
    return this.props.nodeRef ?? this.#nodeRef
  }

  /**
   * Getter for the root element of the component.
   * @returns The root element of the component.
   */
  get rootNode(): Element | null {
    return this.nodeRef.current
  }

  /**
   * The tag name of the component's root node.
   * @returns The tag name.
   */
  get tag(): Tag<Props> { return 'div' }

  /**
   * Determines if the component should update.
   * @param nextProps The next props.
   * @param nextState The next state.
   * @returns Whether the component should update.
   */
  shouldComponentUpdate(nextProps: Readonly<Props & TProps<Element>>, nextState: Readonly<State>): boolean {
    return !deepEquals(this.props, nextProps) || !deepEquals(this.state, nextState)
  }

  /** Called after component mounts. */
  componentDidMount(): void {
    this.applyMixins('componentDidMount')
  }

  /**
   * Called after component updates.
   * @param prevProps The previous props.
   * @param prevState The previous state.
   */
  componentDidUpdate(prevProps: Readonly<Props & TProps<Element>>, prevState: Readonly<State>): void {
    this.applyMixins('componentDidUpdate', prevProps, prevState)
  }

  /** Called before component unmounts. */
  componentWillUnmount(): void {
    this.applyMixins('componentWillUnmount')
  }

  get mixins(): Mixin<Props>[] {
    return Array.from((this.constructor as typeof Component).mixins)
      // ensure post mixins are applied last
      .sort((a, b) => (a.post && !b.post ? 1 : -1))
  }

  /**
   * Renders the component's content. Called once per render.
   * @param children The children of the component.
   * @returns The rendered content.
   */
  content(children?: React.ReactNode): React.ReactNode {
    if (!React.isValidElement(children)) return children
    return this.mixins.reduce((content, mixin) => (
      mixin.content?.(content, this) ?? content
    ), children)
  }

  /**
   * Renders the component.
   * @returns The rendered React node.
   */
  render(): React.ReactNode {
    const Tag = this.tag
    const { children, className, nodeRef } = this.props

    const rendered = ( // @ts-expect-error - we are assuming a props match
      <Tag // @ts-expect-error - we are assuming a props match
        ref={nodeRef ?? this.nodeRef}
        {...this.attributes}
        className={classNames(className, this.classNames)}
      >
        {this.content(children)}
      </Tag>
    )

    return this.mixins.reduce((element, mixin) => (
      typeof mixin.render === 'function'
        ? mixin.render(element, this)
        : element
    ), rendered)
  }

  /**
   * Handles keyboard events with basic onKeyDown functionality.
   * @param event The keyboard event.
   */
  protected handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    this.props.onKeyDown(event)
  }

  /**
   * Sets the state of the component.
   * @param state A partial state update or updater function. Partial state updates are shallow-merged.
   * @param callback Callback to receive updated state after update/re-render is complete.
   * @returns Promise<State> that resolves after update/re-render is complete.
   */
  // @ts-expect-error - Intentionally improving the base-class's type signature.
  override async setState(
    // Note: @types/react says `State`, but `Partial<State>` is correct.
    state: Partial<State> | ((current: State) => Partial<State>),
    callback: ((state: State) => void) = noop,
  ): Promise<State> {
    await new Promise<void>(resolve => (
      super.setState(state as State, () => {
        callback(this.state)
        resolve()
      })
    ))
    return this.state
  }

  private applyMixins(event: keyof Mixin<Props>, ...args: unknown[]): void {
    const mixins = (this.constructor as typeof Component).mixins
    if (!mixins.size) return

    // For other lifecycle methods, just call them
    Array.from(mixins).forEach(mixin => {
      const method = mixin[event] as (component: typeof this, ...args: unknown[]) => void
      method?.(this, ...args)
    })
  }
}
