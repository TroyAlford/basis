import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Constrained extends IconBase {
  static displayName = 'ConstrainedIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <g
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={filled ? 15 : 10}
      >
        <path d="M75 -41.6667V41.6667" />
        <path d="M-75 -41.6667V41.6667" />
        <path d="M-41.6667 0H41.6667M-41.6667 0L-20.8333 -20.8333M-41.6667 0L-20.8333 20.8333M41.6667 0L20.8333 -20.8333M41.6667 0L20.8333 20.8333" />
      </g>
    )
  }
}
