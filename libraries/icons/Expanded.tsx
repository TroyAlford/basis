import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Expanded extends IconBase {
  static displayName = 'ExpandedIcon'
  renderContent = (): React.ReactNode => (
    <path d="M54.875 -47.4L1.075 47.2L-53.125 -47.4H54.875Z" />
  )
}
