import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class Chart extends IconBase {
  static displayName = 'ChartIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M-20 -55C-20 -63.2812 -13.2812 -70 -5 -70H5C13.2813 -70 20 -63.2812 20 -55V55C20 63.2813 13.2813 70 5 70H-5C-13.2812 70 -20 63.2813 -20 55V-55ZM-80 5C-80 -3.2812 -73.2812 -10 -65 -10H-55C-46.7187 -10 -40 -3.2812 -40 5V55C-40 63.2813 -46.7187 70 -55 70H-65C-73.2812 70 -80 63.2813 -80 55V5ZM55 -50H65C73.2813 -50 80 -43.2812 80 -35V55C80 63.2813 73.2813 70 65 70H55C46.7188 70 40 63.2813 40 55V-35C40 -43.2812 46.7188 -50 55 -50Z"
        data-name="chart"
        fill={filled}
      />
    )
  }
}
