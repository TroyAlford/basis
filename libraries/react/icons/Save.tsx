import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Circle } from './parts/Circle'
import { Path } from './parts/Path'

export class Save extends IconBase {
  static displayName = 'SaveIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const circle = <Circle data-name="circle" position={[0, 35]} radius={25} />
    const mask = this.mask('circle', circle)
    const outline = (
      <Path
        d="M-80 -80 H 50 L 80 -50 V80 80 H-80 Z M-50 -80 V -10 H 50 V -80 Z"
        data-name="outline"
        fill={filled}
        mask={mask.props.url}
        stroke={10}
      />
    )
    return (
      <>
        <defs>{mask}</defs>
        {outline}
        {!filled && circle}
      </>
    )
  }
}
