import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Circle } from '../parts/Circle'

export class Borders extends IconBase {
  static displayName = 'BordersIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        {/* Top side (left to right) */}
        <Circle fill={filled} position={[-70, -70]} radius={12.5} />
        <Circle fill={filled} position={[-22.5, -70]} radius={12.5} />
        <Circle fill={filled} position={[22.5, -70]} radius={12.5} />
        <Circle fill={filled} position={[70, -70]} radius={12.5} />
        {/* Bottom side (left to right) */}
        <Circle fill={filled} position={[-70, 70]} radius={12.5} />
        <Circle fill={filled} position={[-22.5, 70]} radius={12.5} />
        <Circle fill={filled} position={[22.5, 70]} radius={12.5} />
        <Circle fill={filled} position={[70, 70]} radius={12.5} />
        {/* Left side (top to bottom) */}
        <Circle fill={filled} position={[-70, -22.5]} radius={12.5} />
        <Circle fill={filled} position={[-70, 22.5]} radius={12.5} />
        {/* Right side (top to bottom) */}
        <Circle fill={filled} position={[70, -22.5]} radius={12.5} />
        <Circle fill={filled} position={[70, 22.5]} radius={12.5} />
      </>
    )
  }
}
