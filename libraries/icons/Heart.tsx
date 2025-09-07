import * as React from 'react'
import { HeartFilled } from './HeartFilled'
import { HeartOutline } from './HeartOutline'
import type { IconProps } from './IconBase/IconBase'
import { IconBase } from './IconBase/IconBase'

interface HeartProps extends IconProps {
  /** Whether the heart is filled or outlined */
  filled?: boolean,
}

/**
 * Heart icon component with convenience syntax support.
 * Supports both prop-based and namespace-based usage.
 */
export class Heart extends IconBase<HeartProps> {
  static displayName = 'Heart'
  static get defaultProps() {
    return {
      ...super.defaultProps,
      filled: false,
    }
  }

  // Namespace access for convenience syntax
  static Filled = HeartFilled
  static Outline = HeartOutline

  // Required abstract methods from IconBase
  renderContent = (): React.ReactNode => {
    const { filled, ...props } = this.props
    return filled
      ? <HeartFilled {...props} />
      : <HeartOutline {...props} />
  }
  readonly viewBox = '0 0 24 24'
}
