import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class GripBottomLeft extends IconBase {
  static displayName = 'GripBottomLeftIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <circle
          cx={0}
          cy={0}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={14}
          strokeWidth="10"
        />
        <circle
          cx={50}
          cy={50}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={14}
          strokeWidth="10"
        />
        <circle
          cx={-50}
          cy={0}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={14}
          strokeWidth="10"
        />
        <circle
          cx={0}
          cy={50}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={14}
          strokeWidth="10"
        />
        <circle
          cx={-50}
          cy={-50}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={14}
          strokeWidth="10"
        />
        <circle
          cx={-50}
          cy={50}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={14}
          strokeWidth="10"
        />
      </>
    )
  }
}
