import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Circle } from '../parts/Circle'

export class GripVertical extends IconBase {
  static displayName = 'GripVerticalIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <Circle fill={filled} position={[-25, 0]} radius={12.5} stroke={10} />
        <Circle fill={filled} position={[25, 0]} radius={12.5} stroke={10} />
        <Circle fill={filled} position={[-25, -50]} radius={12.5} stroke={10} />
        <Circle fill={filled} position={[25, -50]} radius={12.5} stroke={10} />
        <Circle fill={filled} position={[-25, 50]} radius={12.5} stroke={10} />
        <Circle fill={filled} position={[25, 50]} radius={12.5} stroke={10} />
      </>
    )
  }
}
