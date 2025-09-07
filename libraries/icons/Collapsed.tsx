import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Collapsed extends IconBase {
  static displayName = 'CollapsedIcon'
  renderContent = (): React.ReactNode => (
    <path d="M0 7.744l16.32 8.224-16.32 8.256v-16.48z" />
  )
  viewBox = '0 0 16 32'
}
