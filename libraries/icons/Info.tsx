import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Circle } from './parts/Circle'
import { Path } from './parts/Path'
import { Rect } from './parts/Rect'

export class Info extends IconBase {
  static displayName = 'InfoIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const circle = (
      <Circle
        data-name="circle"
        fill={filled}
        mask={filled ? 'url(#basis:icon:info:mask:letter)' : undefined}
        position={[0, 0]}
        radius={80}
        stroke={10}
      />
    )

    const letter = (
      <Path
        fill
        d="M23.86 42.88V28.64Q23.86 27.36 23.06 26.56T21.14 25.76H12.5V-20Q12.5 -21.28 11.7 -22.08T9.62 -22.88H-18.86Q-20.14 -22.88 -20.94 -22.08T-21.74 -20V-5.76Q-21.74 -4.48 -20.94 -3.68T-18.86 -2.88H-10.38V25.76H-18.86Q-20.14 25.76 -20.94 26.56T-21.74 28.64V42.88Q-21.74 44.16 -20.94 44.96T-18.86 45.76H21.14Q22.26 45.76 23.06 44.96T23.86 42.88ZM12.5 -37.12V-51.36Q12.5 -52.64 11.7 -53.44T9.62 -54.24H-7.5Q-8.78 -54.24 -9.58 -53.44T-10.38 -51.36V-37.12Q-10.38 -35.84 -9.58 -35.04T-7.5 -34.24H9.62Q10.9 -34.24 11.7 -35.04T12.5 -37.12Z"
        data-name="letter"
        stroke={0}
      />
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:info:mask:letter">
              <Rect
                fill
                color="white"
                height={200}
                width={200}
                x={-100}
                y={-100}
              />
              {React.cloneElement(letter, { color: 'black' })}
            </mask>
          </defs>
          {circle}
        </>
      )
    }

    return (
      <>
        {circle}
        {letter}
      </>
    )
  }
}
