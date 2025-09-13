import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Circle } from './parts/Circle'
import { Path } from './parts/Path'
import { LineCap } from './types/LineCap'
import { LineJoin } from './types/LineJoin'

export class Gear extends IconBase {
  static displayName = 'GearIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const gear = (
      <Path
        d="M15.4929 -80.1024H-16.466L-25.6851 -43.6363L-61.7413 -54.0845L-77.9257 -26.2228L-50.6785 0L-77.9257 26.0179L-61.7413 53.6747L-25.6851 43.4315L-16.466 79.8976H15.4929L24.5071 43.4315L60.9731 53.6747L76.7477 26.0179L49.7054 0L76.7477 -26.2228L60.9731 -54.0845L24.5071 -43.6363Z"
        data-name="gear"
        fill={filled}
        lineCap={LineCap.Round}
        lineJoin={LineJoin.Round}
        stroke={filled ? 0 : 10}
      />
    )

    const circle = (
      <Circle
        data-name="circle"
        fill={filled}
        position={[0, 0]}
        radius={19.8}
        stroke={filled ? 0 : 10}
      />
    )
    const circleMask = this.mask('circle', circle)

    return (
      <>
        <defs>{circleMask}</defs>
        {React.cloneElement(gear, { mask: filled ? circleMask.props.url : undefined })}
        {!filled && circle}
      </>
    )
  }
}
