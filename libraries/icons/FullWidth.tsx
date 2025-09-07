import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class FullWidth extends IconBase {
  static displayName = 'FullWidthIcon'
  renderContent = (): React.ReactNode => (
    <path
      d="M-75 0H75M-75 0L-41.6667 -33.3333M-75 0L-41.6667 33.3333M75 0L41.6667 33.3333M75 0L41.6667 -33.3333"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={16.666666666666668}
    />
  )
}
