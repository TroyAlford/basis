import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Path } from '../parts/Path'

export class TriangleUp extends IconBase {
  static displayName = 'TriangleUpIcon'

  renderContent = (): React.ReactNode => (
    <Path
      d="M54.875 47.2L1.075 -47.4L-53.125 47.2H54.875Z"
      fill={this.props.filled}
    />
  )
}
