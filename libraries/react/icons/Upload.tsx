import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Circle } from './parts/Circle'
import { Path } from './parts/Path'

export class Upload extends IconBase {
  static displayName = 'UploadIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const circle = <Circle data-name="circle" position={[45, 45]} radius={7.5} />
    const mask = this.mask('circle', React.cloneElement(circle, { fill: true }))

    const outline = (
      <Path
        d="M10 -45.8437V20C10 25.5313 5.5313 30 0 30S-10 25.5313 -10 20V-45.8437L-22.9375 -32.9062C-26.8437 -29 -33.1875 -29 -37.0937 -32.9062S-41 -43.1562 -37.0937 -47.0625L-7.0937 -77.0625C-3.1875 -80.9687 3.1563 -80.9687 7.0625 -77.0625L37.0625 -47.0625C40.9688 -43.1562 40.9688 -36.8125 37.0625 -32.9062S26.8125 -29 22.9063 -32.9062L10 -45.8437ZM0 45C13.8125 45 25 33.8125 25 20H50C61.0313 20 70 28.9688 70 40V50C70 61.0313 61.0313 70 50 70H-50C-61.0312 70 -70 61.0313 -70 50V40C-70 28.9688 -61.0312 20 -50 20H-25C-25 33.8125 -13.8125 45 0 45Z"
        data-name="upload"
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
