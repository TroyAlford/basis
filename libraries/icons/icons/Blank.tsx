import type * as React from 'react'
import { IconBase } from '../IconBase/IconBase'

export class Blank extends IconBase {
  static displayName = 'BlankIcon'
  renderContent = (): React.ReactNode => null
}
