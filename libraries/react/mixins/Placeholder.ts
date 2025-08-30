import * as React from 'react'
import type { Mixin } from '../types/Mixin'

/** Interface for elements with placeholder text. */
export interface IPlaceholder {
  /** Placeholder text displayed when the field is empty. */
  placeholder?: string,
}

/** Mixin for elements with placeholder text. */
export const Placeholder: Mixin<IPlaceholder> = {
  /**
   * Applies placeholder props to a React element.
   * @param element The React element to apply props to.
   * @param component The component instance with placeholder props.
   * @param component.props The props of the component.
   * @returns The enhanced React element.
   */
  content<T extends React.ReactElement>(
    element: T,
    component: { props: IPlaceholder },
  ): T {
    const { placeholder } = component.props
    const elementProps = element.props as React.HTMLAttributes<HTMLElement>

    return React.cloneElement(element, {
      ...elementProps,
      placeholder,
    } as React.HTMLAttributes<HTMLElement>) as T
  },

  /** Default props for elements with placeholder text. */
  defaultProps: {},
}
