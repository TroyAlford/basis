import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Subtract extends IconBase {
  static displayName = 'SubtractIcon'
  renderContent = (): React.ReactNode => (
    <path d="M416 208H32c-17.67 0-32 14.33-32 32v32c0 17.67 14.33 32 32 32h384c17.67 0 32-14.33 32-32v-32c0-17.67-14.33-32-32-32z" />
  )
  viewBox = '0 0 448 512'
}
