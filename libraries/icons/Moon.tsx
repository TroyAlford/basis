import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Moon extends IconBase {
  static displayName = 'MoonIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    return (
      <path
        d="M8.5034 80C33.1791 80 55.7156 68.7734 70.6463 50.3775C72.855 47.6562 70.4466 43.6806 67.0331 44.3306C28.2197 51.7225 -7.4238 21.9631 -7.4238 -17.2175C-7.4238 -39.7869 4.6581 -60.5409 24.2944 -71.7156C27.3212 -73.4381 26.56 -78.0272 23.1206 -78.6625C18.2992 -79.5516 13.4062 -79.9992 8.5034 -80C-35.6556 -80 -71.4966 -44.2153 -71.4966 0C-71.4966 44.1591 -35.7119 80 8.5034 80Z"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        strokeWidth="10"
      />
    )
  }
}
