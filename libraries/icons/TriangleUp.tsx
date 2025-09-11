import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class TriangleUp extends IconBase {
  static displayName = 'TriangleUpIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    return (
      <path
        d="M54.875 47.2L1.075 -47.4L-53.125 47.2H54.875Z"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        strokeWidth={10}
      />
    )
  }
}
