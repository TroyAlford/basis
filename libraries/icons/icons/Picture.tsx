import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Circle } from '../parts/Circle'
import { Path } from '../parts/Path'

export class Picture extends IconBase {
  static displayName = 'PictureIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const moon = <Circle data-name="moon" position={[-45, -30]} radius={17.5} stroke={10} />
    const mountain = <Path d="M62 6V45H-62V28L-34 0L-19 14L25 -31Z" data-name="mountain" stroke={10} />
    const mask = this.mask(
      'frame',
      <>
        {React.cloneElement(moon, { fill: true, stroke: 0 })}
        {React.cloneElement(mountain, { fill: true, stroke: 0 })}
      </>,
    )
    const frame = (
      <Path
        d="M80 -54V54Q80 60 76 64T66 68H-66Q-72 68 -76 64T-80 54V-54Q-80 -60 -76 -64T-66 -68H66Q72 -68 76 -64T80 -54Z"
        data-name="frame"
        fill={filled}
        mask={mask.props.url}
        stroke={10}
      />
    )

    return (
      <>
        <defs>{mask}</defs>
        {frame}
        {!filled && (
          <>
            {moon}
            {mountain}
          </>
        )}
      </>
    )
  }
}
