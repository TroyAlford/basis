import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class StarOutline extends IconBase {
  static displayName = 'StarOutlineIcon'
  renderContent = (): React.ReactNode => (
    <path
      d="M16 2l3.09 6.26L26 9.27l-5 4.87 1.18 6.88L16 17.77l-6.18 3.25L11 14.14 6 9.27l6.91-1.01L16 2z"
      fill="none"
      strokeWidth="1"
    />
  )
  viewBox = '4 1 24 22'
}
