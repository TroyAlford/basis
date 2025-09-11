import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Circle } from './parts/Circle'
import { Path } from './parts/Path'
import { Rect } from './parts/Rect'

export class Picture extends IconBase {
  static displayName = 'PictureIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const frame = (
      <Path
        d="M80 -54V54Q80 60 76 64T66 68H-66Q-72 68 -76 64T-80 54V-54Q-80 -60 -76 -64T-66 -68H66Q72 -68 76 -64T80 -54Z"
        data-name="frame"
        fill={filled}
        mask={filled ? 'url(#basis:icon:picture:mask:frame)' : undefined}
        stroke={10}
      />
    )

    const moon = (
      <Circle data-name="moon" position={[-45, -30]} radius={17.5} stroke={10} />
    )

    const mountain = (
      <Path d="M62 6V45H-62V28L-34 0L-19 14L25 -31Z" data-name="mountain" stroke={10} />
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:picture:mask:frame">
              <Rect
                fill
                color="white"
                height={200}
                width={200}
                x={-100}
                y={-100}
              />
              {React.cloneElement(moon, { color: 'black', fill: true, stroke: 0 })}
              {React.cloneElement(mountain, { color: 'black', fill: true, stroke: 0 })}
            </mask>
          </defs>
          {frame}
        </>
      )
    }

    return (
      <>
        {frame}
        {moon}
        {mountain}
      </>
    )
  }
}
