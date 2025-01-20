import * as React from 'react'
import { classNames, deepEquals, kebabCase } from '@basis/utilities'
import { filterByPrefix } from '../../utilities/filterByPrefix'
import { prefixObject } from '../../utilities/prefixObject'

/** Props for the Component class. */
export interface ComponentProps<
  Element extends HTMLElement = HTMLDivElement,
> {
  /** ARIA attributes to be prefixed with 'aria-' during render. */
  aria?: Record<string, unknown>,
  /** The children of the component. */
  children?: React.ReactNode,
  /** Optional class name(s) to output on the component's root element. */
  className?:
  | string
  | Set<string>
  | Record<string, boolean | (() => boolean)>,
  /** Data attributes to be prefixed with 'data-' during render. */
  data?: Record<string, unknown>,
  /** An optional ref to the component's root element. */
  nodeRef?: React.RefObject<Element>,
}

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
  Element extends HTMLElement = HTMLDivElement,
  /** The state of the component. */
  State = object,
> extends React.Component<Props & ComponentProps, State> {
  static defaultProps: ComponentProps = {
    nodeRef: React.createRef<HTMLDivElement>(),
  }

  /**
   * Getter for ARIA attributes. Values will be prefixed with 'aria-' during render.
   * @returns A Record<string, boolean | number | string> of ARIA attributes.
   */
  get aria(): Record<string, unknown> {
    return {
      ...this.props.aria,
      ...filterByPrefix('aria-', this.props),
    }
  }

  /**
   * Getter for attributes.
   * @returns a React.HTMLAttributes<Element> object
   * @example get attributes() { return { tabIndex: 0 } }
   */
  get attributes(): React.HTMLAttributes<Element> { return {} }

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
   * Getter for data attributes. Values will be prefixed with 'data-' during render.
   * @returns A Record<string, boolean | number | string> of data attributes.
   */
  get data(): Record<string, unknown> {
    return {
      ...this.props.data,
      ...filterByPrefix('data-', this.props),
    }
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
  get rootNode(): HTMLElement | null { return this.props.nodeRef?.current }

  /**
   * The React.ReactHTML tag name of the component's root node.
   * @returns The tag name.
   */
  // eslint-disable-next-line @typescript-eslint/class-literal-property-style
  get tag(): keyof React.ReactHTML { return 'div' }

  /**
   * Determines if the component should update.
   * @param nextProps The next props.
   * @param nextState The next state.
   * @returns Whether the component should update.
   */
  shouldComponentUpdate(nextProps: Readonly<Props & ComponentProps>, nextState: Readonly<State>): boolean {
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
        {...prefixObject('aria-', this.aria)}
        {...prefixObject('data-', this.data)}
        {...this.attributes}
        className={classNames(className, this.classNames)}
      >
        {this.content(children)}
      </Tag>
    )
  }
}
