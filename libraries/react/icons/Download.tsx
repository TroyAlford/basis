import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Circle } from './parts/Circle'
import { Path } from './parts/Path'

export class Download extends IconBase {
  static displayName = 'DownloadIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const circle = <Circle data-name="circle" position={[45, 45]} radius={7.5} />
    const mask = this.mask('circle', React.cloneElement(circle, { fill: true }))

    const outline = (
      <Path
        d="M10 -70C10 -75.5312 5.5313 -80 0 -80S-10 -75.5312 -10 -70V-4.1562L-22.9375 -17.0938C-26.8437 -21 -33.1875 -21 -37.0937 -17.0938S-41 -6.8438 -37.0937 -2.9375L-7.0937 27.0625C-3.1875 30.9687 3.1563 30.9687 7.0625 27.0625L37.0625 -2.9375C40.9688 -6.8438 40.9688 -13.1875 37.0625 -17.0938S26.8125 -21 22.9063 -17.0938L10 -4.1562V-70ZM-50 20C-61.0312 20 -70 28.9688 -70 40V50C-70 61.0313 -61.0312 70 -50 70H50C61.0313 70 70 61.0313 70 50V40C70 28.9688 61.0313 20 50 20H35.3438L17.6563 37.6875C7.9063 47.4375 -7.9375 47.4375 -17.6875 37.6875L-35.3437 20H-50Z"
        data-name="download"
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
