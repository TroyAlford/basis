import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'
import { Rect } from './parts/Rect'
import { LineCap } from './types/LineCap'

export class Navigation extends IconBase {
  static displayName = 'NavigationIcon'

  renderRect = (centerX: number, centerY: number, width: number, height: number, dataName: string): React.ReactNode => {
    const { filled } = this.props
    const x = centerX - (width / 2)
    const y = centerY - (height / 2)

    return (
      <Rect
        data-name={dataName}
        fill={filled}
        height={height}
        rx={10}
        ry={10}
        width={width}
        x={x}
        y={y}
      />
    )
  }

  renderContent = (): React.ReactNode => {
    const connectingLine = (
      <Path
        d="M0 -35L0 35M-65 35L-65 10A10 10 0 0 1 -55 0L55 0A10 10 0 0 1 65 10L65 35"
        data-name="connecting-line"
        lineCap={LineCap.Round}
      />
    )

    return (
      <>
        {this.renderRect(0, -55, 45, 40, 'top-box')}
        {this.renderRect(0, 55, 45, 40, 'bottom-center-box')}
        {this.renderRect(-65, 55, 45, 40, 'bottom-left-box')}
        {this.renderRect(65, 55, 45, 40, 'bottom-right-box')}
        {connectingLine}
      </>
    )
  }
}
