import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Path } from '../parts/Path'

export class Lightning extends IconBase {
  static displayName = 'LightningIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    return (
      <Path
        d="M44 -12 H9 L39 -66 C40 -67 40 -69 39 -70 C38 -72 37 -72 35 -72 H-15 C-17 -72 -19 -71 -20 -70 L-45 7 C-46 9 -45 10 -45 11 C-44 12 -42 13 -41 13 H-5 L-28 67 C-29 69 -28 71 -26 72 C-25 74 -22 73 -21 72 L47 -5 C48 -6 49 -8 48 -10 C47 -11 46 -12 44 -12 ZM44 -12"
        fill={filled}
        stroke={10}
      />
    )
  }
}
