import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class Italic extends IconBase {
  static displayName = 'ItalicIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M39.5508 -60.6445L38.0859 -53.6458H35.8887C30.5718 -53.6458 26.747 -52.6422 24.4141 -50.6348C22.0812 -48.6274 20.5078 -45.6435 19.694 -41.6829L2.4414 40.0228C1.9531 42.3557 1.709 43.9019 1.709 44.6615C1.709 49.1103 5.7237 51.3346 13.7533 51.3346H15.8691L14.4043 58.3333H-34.0983L-32.7962 51.3346H-30.599C-21.3758 51.3346 -15.9234 47.347 -14.2415 39.3717L3.0924 -42.334C3.5265 -44.3956 3.7435 -45.9418 3.7435 -46.9727C3.7435 -51.4215 -0.2712 -53.6458 -8.3008 -53.6458H-10.4167L-8.9518 -60.6445H39.5508Z"
        data-name="italic"
        fill={filled}
        fillRule="evenodd"
      />
    )
  }
}
