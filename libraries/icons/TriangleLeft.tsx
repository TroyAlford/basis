import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class TriangleLeft extends IconBase {
  static displayName = 'TriangleLeftIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    return (
      <path
        d="M52 -51.6L-50 -0.2L52 51.4V-51.6Z"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        strokeWidth="10"
      />
    )
  }
}
