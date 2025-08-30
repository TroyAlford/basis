import * as React from 'react'
import type { Mixin } from '../types/Mixin'

/** Interface for elements that can have prefix/suffix content. */
export interface IPrefixSuffix {
  /** Content to render before the element. */
  prefix?: React.ReactNode,
  /** Content to render after the element. */
  suffix?: React.ReactNode,
}

/** Mixin for elements with prefix/suffix content. */
export const PrefixSuffix: Mixin<IPrefixSuffix> = {
  /**
   * Applies prefix/suffix content around a React element.
   * @param element The main element to render.
   * @param component The component instance with prefix/suffix props.
   * @param component.props The props for the element.
   * @returns The element wrapped with prefix/suffix content.
   */
  content<T extends React.ReactElement>(
    element: T,
    component: { props: IPrefixSuffix },
  ): T {
    const { prefix, suffix } = component.props

    // If no prefix or suffix, just return the element
    if (!prefix && !suffix) {
      return element
    }

    // For prefix/suffix, we wrap the element with prefix/suffix content
    const wrappedElement = (
      <>
        {prefix && (
          <div className="prefix">
            {prefix}
          </div>
        )}
        {element}
        {suffix && (
          <div className="suffix">
            {suffix}
          </div>
        )}
      </>
    ) as T

    return wrappedElement
  },

  /** Default props for elements with prefix/suffix content. */
  defaultProps: {},

  /** This mixin is mutative and should be applied last. */
  post: true,
}
