import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class TriangleDown extends IconBase {
  static displayName = 'TriangleDownIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    return (
      <path
        d="M54.875 -47.4L1.075 47.2L-53.125 -47.4H54.875Z"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        strokeWidth="10"
      />
    )
  }
}
