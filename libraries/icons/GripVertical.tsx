import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class GripVertical extends IconBase {
  static displayName = 'GripVerticalIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <circle
          cx={-26.66666666666667}
          cy={0}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={13.333333333333332}
          strokeWidth="10"
        />
        <circle
          cx={26.666666666666657}
          cy={0}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={13.333333333333332}
          strokeWidth="10"
        />
        <circle
          cx={-26.66666666666667}
          cy={-56.66666666666667}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={13.333333333333332}
          strokeWidth="10"
        />
        <circle
          cx={26.666666666666657}
          cy={-56.66666666666667}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={13.333333333333332}
          strokeWidth="10"
        />
        <circle
          cx={-26.66666666666667}
          cy={56.66666666666666}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={13.333333333333332}
          strokeWidth="10"
        />
        <circle
          cx={26.666666666666657}
          cy={56.66666666666666}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={13.333333333333332}
          strokeWidth="10"
        />
      </>
    )
  }
}
