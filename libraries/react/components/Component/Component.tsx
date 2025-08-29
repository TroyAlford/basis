import * as React from 'react'
import { classNames, deepEquals, kebabCase, noop } from '@basis/utilities'
import { filterByPrefix } from '../../utilities/filterByPrefix'
import { prefixObject } from '../../utilities/prefixObject'

type Tag = keyof React.JSX.IntrinsicElements

/** Props for the Component class. */
interface TProps<
  E extends Element = HTMLDivElement,
> {
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
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => boolean | undefined,
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
  static defaultProps: P<HTMLElement, TProps> = {
    nodeRef: React.createRef<HTMLDivElement>(),
    onKeyDown: () => undefined,
    theme: undefined,
  }

  /**
   * Getter for attributes.
   * @returns a React.HTMLAttributes<Element> object
   * @example get attributes() { return { tabIndex: 0 } }
   */
  get attributes() {
    return {
      'data-theme': this.props.theme,
      ...prefixObject('aria-', filterByPrefix('aria-', this.props)),
      ...prefixObject('data-', filterByPrefix('data-', this.props)),
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
  state = this.defaultState

  /**
   * Getter for the root element of the component.
   * @returns The root element of the component.
   */
  get rootNode(): Element | null { return this.props.nodeRef?.current }

  /**
   * The tag name of the component's root node.
   * @returns The tag name.
   */
  get tag(): Tag { return 'div' }

  /**
   * Determines if the component should update.
   * @param nextProps The next props.
   * @param nextState The next state.
   * @returns Whether the component should update.
   */
  shouldComponentUpdate(nextProps: Readonly<Props & TProps<Element>>, nextState: Readonly<State>): boolean {
    return !deepEquals(this.props, nextProps) || !deepEquals(this.state, nextState)
  }

  /**
   * Renders the component's content. Called once per render.
   * @param children The children of the component.
   * @returns The rendered content.
   */
  content(children?: React.ReactNode): React.ReactNode {
    return children
  }

  /**
   * Renders the component.
   * @returns The rendered React node.
   */
  render(): React.ReactNode {
    const Tag = this.tag
    const { children, className, nodeRef } = this.props

    return ( // @ts-expect-error - we are assuming a props match
      <Tag // @ts-expect-error - we are assuming a props match
        ref={nodeRef}
        {...this.attributes}
        className={classNames(className, this.classNames)}
      >
        {this.content(children)}
      </Tag>
    )
  }

  /**
   * Handles keyboard events with basic onKeyDown functionality.
   * @param event The keyboard event.
   */
  protected handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    const { onKeyDown } = this.props

    // Call onKeyDown first
    const shouldPreventDefault = onKeyDown(event)

    // If onKeyDown returned false, prevent default if not already prevented
    if (shouldPreventDefault === false && !event.defaultPrevented) {
      event.preventDefault()
    }
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
}
