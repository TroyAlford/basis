import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Navigation extends IconBase {
  static displayName = 'NavigationIcon'

  renderRect = (centerX: number, centerY: number, width: number, height: number, dataName: string): React.ReactNode => {
    const { filled } = this.props
    const x = centerX - (width / 2)
    const y = centerY - (height / 2)

    return (
      <rect
        data-name={dataName}
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        height={height}
        rx="10"
        ry="10"
        strokeWidth="10"
        width={width}
        x={x}
        y={y}
      />
    )
  }

  renderContent = (): React.ReactNode => {
    const testSquares = (
      <>
        {this.renderRect(0, -55, 45, 40, 'top-box')}
        {this.renderRect(0, 55, 45, 40, 'bottom-center-box')}
        {this.renderRect(-65, 55, 45, 40, 'bottom-left-box')}
        {this.renderRect(65, 55, 45, 40, 'bottom-right-box')}
      </>
    )

    const connectingLine = (
      <path
        d="M0 -35L0 35M-65 35L-65 10A10 10 0 0 1 -55 0L55 0A10 10 0 0 1 65 10L65 35"
        data-name="connecting-line"
        fill="transparent"
        strokeLinecap="round"
        strokeWidth="10"
      />
    )

    return (
      <>
        {/* {boxes} */}
        {testSquares}
        {connectingLine}
      </>
    )
  }
}
