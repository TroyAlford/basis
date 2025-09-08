import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Borders extends IconBase {
  static displayName = 'BordersIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        {/* Top side (left to right) */}
        <circle
          cx={-68.96551724137932}
          cy={-68.96551724137932}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={12.06896551724138}
          strokeWidth="10"
        />
        <circle
          cx={-22.993333333333332}
          cy={-68.96551724137932}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={12.06896551724138}
          strokeWidth="10"
        />
        <circle
          cx={22.983333333333334}
          cy={-68.96551724137932}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={12.06896551724138}
          strokeWidth="10"
        />
        <circle
          cx={68.96551724137932}
          cy={-68.96551724137932}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={12.06896551724138}
          strokeWidth="10"
        />
        {/* Right side (top to bottom) */}
        <circle
          cx={68.96551724137932}
          cy={-22.993333333333332}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={12.06896551724138}
          strokeWidth="10"
        />
        <circle
          cx={68.96551724137932}
          cy={22.983333333333334}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={12.06896551724138}
          strokeWidth="10"
        />
        {/* Bottom side (right to left) */}
        <circle
          cx={68.96551724137932}
          cy={68.96551724137932}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={12.06896551724138}
          strokeWidth="10"
        />
        <circle
          cx={22.993333333333332}
          cy={68.96551724137932}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={12.06896551724138}
          strokeWidth="10"
        />
        <circle
          cx={-22.983333333333334}
          cy={68.96551724137932}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={12.06896551724138}
          strokeWidth="10"
        />
        <circle
          cx={-68.96551724137932}
          cy={68.96551724137932}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={12.06896551724138}
          strokeWidth="10"
        />
        {/* Left side (bottom to top) */}
        <circle
          cx={-68.96551724137932}
          cy={22.993333333333332}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={12.06896551724138}
          strokeWidth="10"
        />
        <circle
          cx={-68.96551724137932}
          cy={-22.983333333333334}
          fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
          r={12.06896551724138}
          strokeWidth="10"
        />
      </>
    )
  }
}
