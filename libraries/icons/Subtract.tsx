import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Subtract extends IconBase {
  static displayName = 'SubtractIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <path
        d="M67.5 -16.875H-67.5C-73.7121 -16.875 -78.75 -11.8371 -78.75 -5.625V5.625C-78.75 11.8371 -73.7121 16.875 -67.5 16.875H67.5C73.7121 16.875 78.75 11.8371 78.75 5.625V-5.625C78.75 -11.8371 73.7121 -16.875 67.5 -16.875Z"
        data-name="minus"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        strokeWidth="10"
      />
    )
  }
}
