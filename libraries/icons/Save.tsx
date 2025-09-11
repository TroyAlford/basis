import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Circle } from './parts/Circle'
import { Path } from './parts/Path'

export class Save extends IconBase {
  static displayName = 'SaveIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const outline = <Path d="M-80 -80 H 50 L 80 -50 V80 80 H-80 Z M-50 -80 V -10 H 50 V -80 Z" data-name="outline" />
    const circle = <Circle data-name="circle" position={[0, 35]} radius={25} />

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:save:mask">
              <rect fill="white" height={200} width={200} x={-100} y={-100} />
              <circle cx={0} cy={35} fill="black" r={25} />
            </mask>
          </defs>
          {React.cloneElement(outline, { fill: true, mask: 'url(#basis:icon:save:mask)' })}
        </>
      )
    }

    return (
      <>
        {React.cloneElement(outline, { fill: false, stroke: 10 })}
        {React.cloneElement(circle, { fill: false, stroke: 10 })}
      </>
    )
  }
}
