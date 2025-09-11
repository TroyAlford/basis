import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Circle } from './parts/Circle'
import { Path } from './parts/Path'

export class Search extends IconBase {
  static displayName = 'SearchIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    const stroke = filled ? 0 : 10

    const magnifyingGlass = (
      <Path
        d="M-7.0222 48.3556L-28.7111 70.0444Q-37.6 77.8667 -48.8 77.8667Q-60.8889 77.8667 -69.2444 69.1556T-77.7778 48.7111T-69.6 28.4444Q-60.1778 18.8444 -55.5556 14.2222L-48.4444 7.1111Q-51.8222 -3.5556 -51.8222 -13.1556Q-51.8222 -40 -32.8 -58.8444T13.0667 -77.8667Q40.0889 -77.8667 58.9333 -58.8444T77.7778 -13.1556T58.9333 32.7111T13.0667 51.7333Q3.6444 51.7333 -7.0222 48.3556Z"
        data-name="magnifying-glass"
      />
    )

    const outerCircle = (
      <Circle
        data-name="outer-circle"
        position={[13.0667, -13.1556]}
        radius={40}
      />
    )

    const middleCircle = (
      <Circle
        data-name="middle-circle"
        position={[13.0667, -13.1556]}
        radius={24}
      />
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:search:mask">
              <rect
                fill="white"
                height="200"
                width="200"
                x="-100"
                y="-100"
              />
              <circle
                cx="13.0667"
                cy="-13.1556"
                fill="black"
                r="40"
              />
            </mask>
          </defs>
          {React.cloneElement(magnifyingGlass, { fill: true, mask: 'url(#basis:icon:search:mask)' })}
          {React.cloneElement(middleCircle, { fill: false, stroke: 10 })}
        </>
      )
    }

    return (
      <>
        {React.cloneElement(magnifyingGlass, { fill: false, stroke })}
        {React.cloneElement(outerCircle, { fill: false, stroke })}
        {React.cloneElement(middleCircle, { fill: false, stroke })}
      </>
    )
  }
}
