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
      period: 28,
      tilt: 0,
    }
  }

  maskId = randomHash()

  get ellipseWidth(): number {
    const ellipseWidth = (((this.props.day / this.props.period) * 4) % 1) * 100
    return [Phase.WaningGibbous, Phase.WaxingCrescent].includes(this.phase)
      ? 100 - ellipseWidth
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
    switch (this.phase) {
      case (Phase.WaxingCrescent):
        return <Path d={`M 0 -100 A ${this.ellipseWidth} 100 0 0 1 0 100 A 100 100 0 0 0 0 -100 Z`} />
      case (Phase.FirstQuarter):
        return <Path d="M 0 -100 A 100 100 0 0 1 0 100 Z" />
      case (Phase.WaxingGibbous):
        return <Path d={`M 0 -100 A ${this.ellipseWidth} 100 0 0 0 0 100 A 100 100 0 0 0 0 -100 Z`} />
      case (Phase.WaningGibbous):
        return <Path d={`M 0 -100 A 100 100 0 0 0 0 100 A ${this.ellipseWidth} 100 0 0 0 0 -100 Z`} />
      case (Phase.LastQuarter):
        return <Path d="M 0 -100 A 100 100 0 0 0 0 100 Z" />
      case (Phase.WaningCrescent):
        return <Path d={`M 0 -100 A 100 100 0 0 0 0 100 A ${this.ellipseWidth} 100 0 0 1 0 -100 Z`} />
      case (Phase.Full):
        return <Circle position={[0, 0]} radius={100} />
      case (Phase.New): default: return null
    }
  }

  renderContent = (): React.ReactNode => (
    <>
      <Circle color="#1114" position={[0, 0]} radius={100} />
      <g transform={`rotate(${this.props.tilt * 100})`}>{this.renderPath()}</g>
    </>
  )
}
