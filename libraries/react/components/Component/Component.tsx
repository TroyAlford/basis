import * as React from 'react'
import { classNames, dataAttributes, kebabCase } from '@basis/utilities'

export interface ComponentProps {
  /** The children of the component. */
  children?: React.ReactNode,
  /** Optional class name(s) to output on the component's root element. */
  className?:
  | string
  | Set<string>
  | Record<string, boolean | (() => boolean)>,
  /**
   * An optional object of data-* attributes to output on the component's root element.
   * @example { foo: true, bar: 42, baz: 'qux' }
   * // data-foo="true" data-bar="42" data-baz="qux"
   */
  data?: Record<string, boolean | number | string>,
  /** An optional ref to the component's root element. */
  nodeRef?: React.RefObject<HTMLElement>,
}

/**
 * The abstract base `@basis/react` components extend from.
 * @template Props the props of the component
 * @template State the state of the component
 * @template SnapShot the snapshot of the component
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
    data: {},
    nodeRef: React.createRef<HTMLElement>(),
  }

  /**
   * Getter for attributes.
   * @returns a React.HTMLAttributes<Element> object
   * @example get attributes() { return { tabIndex: 0 } }
   */
  get attributes(): React.HTMLAttributes<Element> { return {} }

  /**
   * Getter for class names.
   * @returns a Set<string> of class names
   */
  get classNames(): Set<string> { return new Set<string>() }

  /**
   * Getter for data attributes.
   * @returns a Record<string, boolean | number | string> of data attributes
   */
  get data(): Record<string, boolean | number | string> {
    return {
      ...Object.entries(this.props).reduce((data, [key, value]) => {
        if (key.startsWith('data-')) data[key] = value
        return data
      }, {}),
      ...this.props.data ?? {},
    }
  }

  /**
   * Getter for initialState.
   * @returns the initial state of the component
   */
  get defaultState(): State { return {} as State }
  state = this.defaultState

  /**
   * Getter for root element.
   * @returns the root element of the component
   */
  get rootNode(): HTMLElement | null { return this.props.nodeRef?.current }

  /**
   * The React.ReactHTML tag name of component's root node.
   * @default 'div', which renders an `HTMLDivElement`
   */
  readonly tag: keyof React.ReactHTML = 'div'

  /**
   * Renders the component's content. Called once per render.
   * @param children the children of the component
   * @returns the rendered content
   */
  content(children?: React.ReactNode): React.ReactNode {
    return children
  }

  render(): React.ReactNode {
    const Tag = this.tag
    const { className, nodeRef: rootNodeRef } = this.props

    return ( // @ts-expect-error - we are assuming a props match
      <Tag // @ts-expect-error - we are assuming a props match
        ref={rootNodeRef}
        {...this.attributes}
        {...dataAttributes(this.data)}
        className={classNames(
          // @ts-expect-error - displayName is a valid static on React.Component
          kebabCase(this.constructor.displayName ?? this.constructor.name),
          'component',
          className,
          this.classNames,
        )}
      >
        {this.content(this.props.children)}
      </Tag>
    )
  }
}
