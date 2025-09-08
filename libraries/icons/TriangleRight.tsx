import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class TriangleRight extends IconBase {
  static displayName = 'TriangleRightIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    return (
      <path
        d="M-50 -51.6L52 -0.2L-50 51.4V-51.6Z"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        strokeWidth="10"
      />
    )
  }
}
