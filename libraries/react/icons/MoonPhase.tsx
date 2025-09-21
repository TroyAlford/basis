import * as React from 'react'
import { randomHash } from '@basis/utilities'
import type { IconProps } from './IconBase/IconBase'
import { IconBase } from './IconBase/IconBase'
import { Circle } from './parts/Circle'
import { Path } from './parts/Path'

interface Props extends IconProps {
  day: number,
  period: number,
  tilt: number,
}

enum Phase {
  New,
  WaxingCrescent,
  FirstQuarter,
  WaxingGibbous,
  Full,
  WaningGibbous,
  LastQuarter,
  WaningCrescent,
}

export class MoonPhase extends IconBase<Props> {
  static get defaultProps() {
    return {
      ...super.defaultProps,
      day: 0,
      filled: true,
      period: 28,
      tilt: 0,
    }
  }

  maskId = randomHash()

  get ellipseWidth(): number {
    const ellipseWidth = (((this.props.day / this.props.period) * 4) % 1) * 80
    return [Phase.WaningGibbous, Phase.WaxingCrescent].includes(this.phase)
      ? 80 - ellipseWidth
      : ellipseWidth
  }
  get phase(): Phase {
    const percent = parseFloat((this.props.day / this.props.period).toFixed(2)) % 1
    if (percent === 0) return Phase.New
    if (percent < 0.25) return Phase.WaxingCrescent
    if (percent === 0.25) return Phase.FirstQuarter
    if (percent < 0.50) return Phase.WaxingGibbous
    if (percent === 0.5) return Phase.Full
    if (percent < 0.75) return Phase.WaningGibbous
    if (percent === 0.75) return Phase.LastQuarter
    return Phase.WaningCrescent
  }

  renderPath = (): React.ReactNode => {
    const { filled } = this.props
    const stroke = filled ? 0 : 10

    switch (this.phase) {
      case (Phase.WaxingCrescent):
        return <Path d={`M 0 -80 A ${this.ellipseWidth} 80 0 0 1 0 80 A 80 80 0 0 0 0 -80 Z`} fill={filled} stroke={stroke} />
      case (Phase.FirstQuarter):
        return <Path d="M 0 -80 A 80 80 0 0 1 0 80 Z" fill={filled} stroke={stroke} />
      case (Phase.WaxingGibbous):
        return <Path d={`M 0 -80 A ${this.ellipseWidth} 80 0 0 0 0 80 A 80 80 0 0 0 0 -80 Z`} fill={filled} stroke={stroke} />
      case (Phase.WaningGibbous):
        return <Path d={`M 0 -80 A 80 80 0 0 0 0 80 A ${this.ellipseWidth} 80 0 0 0 0 -80 Z`} fill={filled} stroke={stroke} />
      case (Phase.LastQuarter):
        return <Path d="M 0 -80 A 80 80 0 0 0 0 80 Z" fill={filled} stroke={stroke} />
      case (Phase.WaningCrescent):
        return <Path d={`M 0 -80 A 80 80 0 0 0 0 80 A ${this.ellipseWidth} 80 0 0 1 0 -80 Z`} fill={filled} stroke={stroke} />
      case (Phase.Full):
        return <Circle fill={filled} position={[0, 0]} radius={80} stroke={stroke} />
      case (Phase.New): default: return null
    }
  }

  renderContent = (): React.ReactNode => (
    <>
      <Circle
        color="var(--basis-icon-color-secondary, #11111144)"
        fill={this.props.filled}
        position={[0, 0]}
        radius={80}
        stroke={this.props.filled ? 0 : 10}
      />
      <g transform={`rotate(${this.props.tilt * 100})`}>{this.renderPath()}</g>
    </>
  )
}
