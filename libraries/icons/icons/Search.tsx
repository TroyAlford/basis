import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Circle } from '../parts/Circle'
import { Path } from '../parts/Path'

export class Search extends IconBase {
  static displayName = 'SearchIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const cutout = <Circle data-name="cutout" fill={filled} position={[13.0667, -13.1556]} radius={40} stroke={10} />
    const mask = this.mask('cutout', cutout)

    const lens = <Circle data-name="lens" position={[13.0667, -13.1556]} radius={24} stroke={10} />
    const outline = (
      <Path
        d="M-7.0222 48.3556L-28.7111 70.0444Q-37.6 77.8667 -48.8 77.8667Q-60.8889 77.8667 -69.2444 69.1556T-77.7778 48.7111T-69.6 28.4444Q-60.1778 18.8444 -55.5556 14.2222L-48.4444 7.1111Q-51.8222 -3.5556 -51.8222 -13.1556Q-51.8222 -40 -32.8 -58.8444T13.0667 -77.8667Q40.0889 -77.8667 58.9333 -58.8444T77.7778 -13.1556T58.9333 32.7111T13.0667 51.7333Q3.6444 51.7333 -7.0222 48.3556Z"
        data-name="magnifying-glass"
        fill={filled}
        mask={filled ? mask.props.url : undefined}
        stroke={10}
      />
    )

    return (
      <>
        <defs>{mask}</defs>
        {outline}
        {!filled && cutout}
        {lens}
      </>
    )
  }
}
