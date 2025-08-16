import * as React from 'react'
import { isNil } from '@basis/utilities'
import { Direction } from '../types/Direction'
import type { Mixin } from '../types/Mixin'

/** Default offset value for directional elements. */
const DEFAULT_OFFSET = 0

/**
 * Converts the offset prop to a CSS string.
 * If it's a number, appends 'px'. If it's a string, returns as-is.
 * Empty strings fall back to default.
 * @param offset The offset value to convert.
 * @returns The CSS string representation of the offset
 */
function getOffsetString(offset?: number | string): string {
  if (isNil(offset) || offset === '') return `${DEFAULT_OFFSET}px`
  if (typeof offset === 'number') return `${offset}px`
  return offset
}

/** Interface for directional elements. */
export interface IDirectional {
  /** The direction where the element should appear. */
  direction?: Direction,
  /** The offset distance from the parent element. If a number is provided, 'px' will be appended. */
  offset?: number | string,
}

/** Mixin for directional elements. */
export const Directional: Mixin<IDirectional> = {
  /**
   * Applies directional props to a React element.
   * @param element The React element to apply props to.
   * @param component The component instance with directional props.
   * @param component.props The props of the component.
   * @returns The enhanced React element.
   */
  apply<T extends React.ReactElement>(
    element: T,
    component: { props: IDirectional },
  ): T {
    const { direction, offset } = component.props
    const elementProps = element.props as React.HTMLAttributes<HTMLElement>

    return React.cloneElement(element, {
      ...elementProps,
      'data-direction': direction,
      'style': {
        ...elementProps.style,
        '--directional-offset': getOffsetString(offset),
      },
    } as React.HTMLAttributes<HTMLElement>) as T
  },

  /** Default props for directional elements. */
  defaultProps: {
    direction: Direction.S,
    offset: DEFAULT_OFFSET,
  },
}
