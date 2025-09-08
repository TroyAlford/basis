import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class GripHorizontal extends IconBase {
  static displayName = 'GripHorizontalIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <circle
          cx={0}
          cy={-26.66666666666667}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={13.333333333333332}
          strokeWidth="10"
        />
        <circle
          cx={0}
          cy={26.666666666666657}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={13.333333333333332}
          strokeWidth="10"
        />
        <circle
          cx={-56.66666666666667}
          cy={-26.66666666666667}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={13.333333333333332}
          strokeWidth="10"
        />
        <circle
          cx={-56.66666666666667}
          cy={26.666666666666657}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={13.333333333333332}
          strokeWidth="10"
        />
        <circle
          cx={56.66666666666666}
          cy={-26.66666666666667}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={13.333333333333332}
          strokeWidth="10"
        />
        <circle
          cx={56.66666666666666}
          cy={26.666666666666657}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={13.333333333333332}
          strokeWidth="10"
        />
      </>
    )
  }
}
