import type * as React from 'react'

/** Type for mixin objects. */
export interface Mixin<Props> {
  /** Props interface for the mixin. */
  Props: Props,
  /** Applies mixin props to a React element. */
  apply<T extends React.ReactElement>(
    element: T,
    component: { props: Props },
  ): T,
  /** Default props for the mixin. */
  defaultProps: Partial<Props>,
  /** Whether this mixin should be applied after other mixins (mutative mixins). */
  post?: boolean,
}
