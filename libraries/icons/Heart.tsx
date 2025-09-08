import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

/**
 * Heart icon component with fill control.
 */
export class Heart extends IconBase {
  static displayName = 'Heart'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    return (
      <path
        d="M80 -26.72Q80 -7.04 59.52 13.44L4 67.04Q2.4 68.64 0 68.64T-4 67.04L-59.68 13.28Q-60.48 12.48 -62.08 10.88T-67.04 4.96T-73.12 -3.68T-77.92 -14.4T-80 -26.72Q-80 -46.4 -68.64 -57.44T-37.28 -68.64Q-31.84 -68.64 -26.08 -66.72T-15.36 -61.44T-6.72 -55.36T0 -49.28Q3.2 -52.48 6.72 -55.36T15.36 -61.44T26.08 -66.72T37.28 -68.64Q57.28 -68.64 68.64 -57.44T80 -26.72Z"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        strokeWidth="10"
      />
    )
  }
}
