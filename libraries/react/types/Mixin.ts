import type * as React from 'react'
import type { Component } from '../components/Component/Component'

/** Type for mixin objects. */
export interface Mixin<Props = unknown> {
  /** Attributes to apply to the component. */
  attributes?: (props: Props) => Record<string, boolean | string>,
  /** Called after component mounts. */
  componentDidMount?<E extends HTMLElement | SVGElement, S>(
    component: Component<Props, E, S>,
  ): void,
  /** Called after component updates. */
  componentDidUpdate?<E extends HTMLElement | SVGElement, S>(
    component: Component<Props, E, S>,
    prevProps: Props,
    prevState: unknown,
  ): void,
  /** Called before component unmounts. */
  componentWillUnmount?<E extends HTMLElement | SVGElement, S>(
    component: Component<Props, E, S>,
  ): void,
  /** Applies mixin props to a React element. */
  content?<T extends React.ReactElement>(
    element: T,
    component: { props: Props },
  ): T,
  /** Default props for the mixin. */
  defaultProps: Partial<Props>,
  /** Whether this mixin should be applied after other mixins (mutative mixins). */
  post?: boolean,
  /** Applies mixin props to a React element. */
  render?<T extends React.ReactElement>(
    element: T,
    component: { props: Props },
  ): T,
}
