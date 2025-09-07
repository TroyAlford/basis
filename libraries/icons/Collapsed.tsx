import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Collapsed extends IconBase {
  static displayName = 'CollapsedIcon'
  renderContent = (): React.ReactNode => (
    <path d="M-50 -51.6L52 -0.2L-50 51.4V-51.6Z" />
  )
}
