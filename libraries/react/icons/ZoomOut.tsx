import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class ZoomOut extends IconBase {
  static displayName = 'ZoomOutIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const detail = (
      <Path
        d="M-37.5 -22.5C-41.6562 -22.5 -45 -19.1562 -45 -15S-41.6562 -7.5 -37.5 -7.5H7.5C11.6563 -7.5 15 -10.8437 15 -15S11.6563 -22.5 7.5 -22.5H-37.5Z"
        data-name="minus"
      />
    )
    const mask = this.mask('minus', React.cloneElement(detail, { fill: true }))

    const lens = (
      <Path
        d="M50 -15C50 -0.6562 45.3438 12.5938 37.5 23.3438L77.0625 62.9375C80.9688 66.8438 80.9688 73.1875 77.0625 77.0938S66.8125 81 62.9063 77.0938L23.3438 37.5C12.5938 45.3438 -0.6562 50 -15 50C-50.9062 50 -80 20.9063 -80 -15S-50.9062 -80 -15 -80S50 -50.9062 50 -15Z"
        data-name="magnifying-glass-minus"
        fill={filled}
        mask={mask.props.url}
        stroke={10}
      />
    )

    return (
      <>
        <defs>{mask}</defs>
        {lens}
        {!filled && detail}
      </>
    )
  }
}
