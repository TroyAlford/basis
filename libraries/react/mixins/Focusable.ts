import * as React from 'react'
import type { Mixin } from '../types/Mixin'

/** Interface for elements that can receive focus. */
export interface IFocusable {
  /** Whether the element can automatically receive focus. */
  autoFocus?: boolean,
  /** Whether the element is disabled. */
  disabled?: boolean,
  /** Callback function called when the element loses focus. */
  onBlur?: (event: React.FocusEvent<HTMLElement>) => void,
  /** Callback function called when the element receives focus. */
  onFocus?: (event: React.FocusEvent<HTMLElement>) => void,
  /** Whether the element is read-only. */
  readOnly?: boolean,
  /** Tab index for keyboard navigation. */
  tabIndex?: number,
}

/** Mixin for focusable elements. */
export const Focusable: Mixin<IFocusable> = {
  /**
   * Applies focusable props to a React element.
   * @param element The React element to apply props to.
   * @param component The component instance with focusable props.
   * @param component.props The props for the element.
   * @returns The enhanced React element.
   */
  apply<T extends React.ReactElement>(
    element: T,
    component: { props: IFocusable },
  ): T {
    const { autoFocus, disabled, onBlur, onFocus, readOnly, tabIndex } = component.props
    const elementProps = element.props as React.HTMLAttributes<HTMLElement>

    return React.cloneElement(element, {
      ...elementProps,
      autoFocus,
      disabled,
      onBlur,
      onFocus,
      readOnly,
      tabIndex: (disabled || readOnly) ? -1 : tabIndex,
    } as React.HTMLAttributes<HTMLElement>) as T
  },

  /** Default props for focusable elements. */
  defaultProps: {
    disabled: false,
    readOnly: false,
    tabIndex: 0,
  },
}
