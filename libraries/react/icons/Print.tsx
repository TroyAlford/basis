import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class Print extends IconBase {
  static displayName = 'PrintIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M-60 -60C-60 -71.0312 -51.0312 -80 -40 -80H26.7188C32.0313 -80 37.125 -77.9062 40.875 -74.1562L54.1563 -60.875C57.9063 -57.125 60 -52.0312 60 -46.7187V-35H-60V-60ZM-80 0C-80 -11.0312 -71.0312 -20 -60 -20H60C71.0313 -20 80 -11.0312 80 0V30C80 35.5313 75.5313 40 70 40H60V60C60 71.0313 51.0313 80 40 80H-40C-51.0312 80 -60 71.0313 -60 60V40H-70C-75.5312 40 -80 35.5313 -80 30V0ZM-40 50V60H40V30H-40V50ZM62.5 5C62.5 -0.7735 56.25 -4.3819 51.25 -1.4952C48.9295 -0.1554 47.5 2.3205 47.5 5C47.5 10.7735 53.75 14.3819 58.75 11.4952C61.0705 10.1554 62.5 7.6795 62.5 5Z"
        data-name="print"
        fill={filled}
      />
    )
  }
}
