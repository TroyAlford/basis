import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Expanded extends IconBase {
  static displayName = 'ExpandedIcon'
  renderContent = (): React.ReactNode => (
    <path d="M17.28 8.416l-8.608 15.136-8.672-15.136h17.28z" />
  )
  viewBox = '0 0 17 32'
}
