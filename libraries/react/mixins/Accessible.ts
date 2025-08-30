import * as React from 'react'
import type { Mixin } from '../types/Mixin'

/** Interface for accessible elements. */
export interface IAccessible {
  /** ID of the element that describes this element (help text). */
  describedBy?: string,
  /** ID of the element that contains error messages for this element. */
  errorMessage?: string,
  /** Whether the element has a popup (dropdown, suggestions, etc.). */
  hasPopup?: boolean | 'dialog' | 'grid' | 'listbox' | 'menu' | 'tree',
  /** Whether the element has validation errors. */
  invalid?: boolean,
  /** ARIA label for the element (for screen readers). */
  label?: string,
  /** ID of the element that labels this element. */
  labelledBy?: string,
}

/** Mixin for accessible elements. */
export const Accessible: Mixin<IAccessible> = {
  /**
   * Applies accessible props to a React element.
   * @param element The React element to apply props to.
   * @param component The component instance with accessible props.
   * @param component.props The props of the component.
   * @returns The enhanced React element.
   */
  content<T extends React.ReactElement>(
    element: T,
    component: { props: IAccessible },
  ): T {
    const { describedBy, errorMessage, hasPopup, invalid, label, labelledBy } = component.props
    const elementProps = element.props as React.HTMLAttributes<HTMLElement>

    return React.cloneElement(element, {
      ...elementProps,
      'aria-describedby': describedBy,
      'aria-errormessage': errorMessage,
      'aria-haspopup': hasPopup ? String(hasPopup) : undefined,
      'aria-invalid': invalid ? 'true' : 'false',
      'aria-label': label,
      'aria-labelledby': labelledBy,
    } as React.HTMLAttributes<HTMLElement>) as T
  },

  /** Default props for accessible elements. */
  defaultProps: {
    invalid: false,
  },
}
