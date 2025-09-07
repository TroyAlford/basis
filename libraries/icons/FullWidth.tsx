import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class FullWidth extends IconBase {
  static displayName = 'FullWidthIcon'
  renderContent = (): React.ReactNode => (
    <path
      d="M3 12H21M3 12L7 8M3 12L7 16M21 12L17 16M21 12L17 8"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  )
  viewBox = '0 0 24 24'
}
