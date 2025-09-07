import type * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Blank extends IconBase {
  static displayName = 'BlankIcon'
  renderContent = (): React.ReactNode => null
  viewBox = '0 -4 27 40'
}
