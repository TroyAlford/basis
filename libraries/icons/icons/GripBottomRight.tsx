import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Circle } from '../parts/Circle'

export class GripBottomRight extends IconBase {
  static displayName = 'GripBottomRightIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <Circle fill={filled} position={[0, 0]} radius={12.5} />
        <Circle fill={filled} position={[50, 50]} radius={12.5} />
        <Circle fill={filled} position={[50, 0]} radius={12.5} />
        <Circle fill={filled} position={[0, 50]} radius={12.5} />
        <Circle fill={filled} position={[50, -50]} radius={12.5} />
        <Circle fill={filled} position={[-50, 50]} radius={12.5} />
      </>
    )
  }
}
