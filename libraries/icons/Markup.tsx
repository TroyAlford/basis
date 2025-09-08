import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Markup extends IconBase {
  static displayName = 'MarkupIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <g
        fill="transparent"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={filled ? 20 : 10}
      >
        <path d="M-35 40L-76 0L-35 -40" data-name="left-caret" />
        <path d="M35 40L76 0L35 -40" data-name="right-caret" />
        <path d="M-10 50L10 -50" data-name="center-slash" />
      </g>
    )
  }
}
