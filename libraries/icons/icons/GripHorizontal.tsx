import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Circle } from '../parts/Circle'

export class GripHorizontal extends IconBase {
  static displayName = 'GripHorizontalIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <Circle fill={filled} position={[0, -25]} radius={12.5} stroke={10} />
        <Circle fill={filled} position={[0, 25]} radius={12.5} stroke={10} />
        <Circle fill={filled} position={[-50, -25]} radius={12.5} stroke={10} />
        <Circle fill={filled} position={[-50, 25]} radius={12.5} stroke={10} />
        <Circle fill={filled} position={[50, -25]} radius={12.5} stroke={10} />
        <Circle fill={filled} position={[50, 25]} radius={12.5} stroke={10} />
      </>
    )
  }
}
