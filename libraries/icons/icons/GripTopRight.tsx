import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Circle } from '../parts/Circle'

export class GripTopRight extends IconBase {
  static displayName = 'GripTopRightIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <Circle fill={filled} position={[0, 0]} radius={14} stroke={10} />
        <Circle fill={filled} position={[50, 50]} radius={14} stroke={10} />
        <Circle fill={filled} position={[50, 0]} radius={14} stroke={10} />
        <Circle fill={filled} position={[0, -50]} radius={14} stroke={10} />
        <Circle fill={filled} position={[50, -50]} radius={14} stroke={10} />
        <Circle fill={filled} position={[-50, -50]} radius={14} stroke={10} />
      </>
    )
  }
}
