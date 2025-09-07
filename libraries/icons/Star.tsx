import * as React from 'react'
import { StarFilled } from './StarFilled'
import { StarOutline } from './StarOutline'
import { IconBase } from './IconBase/IconBase'
import type { IconProps } from './IconBase/IconBase'

interface StarProps extends IconProps {
  /** Whether the star is filled or outlined */
  filled?: boolean,
}

/**
 * Star icon component with convenience syntax support.
 * Supports both prop-based and namespace-based usage.
 */
export class Star extends IconBase<StarProps> {
  static displayName = 'Star'
  static get defaultProps() {
    return {
      ...super.defaultProps,
      filled: false,
    }
  }

  // Namespace access for convenience syntax
  static Filled = StarFilled
  static Outline = StarOutline

  // Required abstract methods from IconBase
  renderContent = (): React.ReactNode => {
    const { filled, ...props } = this.props
    return filled
      ? <StarFilled {...props} />
      : <StarOutline {...props} />
  }
  readonly viewBox = '0 0 32 32'
}
