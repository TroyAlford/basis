import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Subtract extends IconBase {
  static displayName = 'SubtractIcon'
  renderContent = (): React.ReactNode => (
    <path d="M75 -18.75H-75C-81.9023 -18.75 -87.5 -13.1523 -87.5 -6.25V6.25C-87.5 13.1523 -81.9023 18.75 -75 18.75H75C81.9023 18.75 87.5 13.1523 87.5 6.25V-6.25C87.5 -13.1523 81.9023 -18.75 75 -18.75Z" />
  )
}
