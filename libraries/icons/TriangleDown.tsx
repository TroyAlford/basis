import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class TriangleDown extends IconBase {
  static displayName = 'TriangleDownIcon'

  renderContent = (): React.ReactNode => (
    <Path
      d="M54.875 -47.4L1.075 47.2L-53.125 -47.4H54.875Z"
      fill={this.props.filled}
    />
  )
}
