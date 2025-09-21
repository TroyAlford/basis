import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class FullWidth extends IconBase {
  static displayName = 'FullWidthIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M-75 0H75M-75 0L-41.6667 -33.3333M-75 0L-41.6667 33.3333M75 0L41.6667 33.3333M75 0L41.6667 -33.3333"
        fill={filled}
        stroke={filled ? 20 : 10}
      />
    )
  }
}
