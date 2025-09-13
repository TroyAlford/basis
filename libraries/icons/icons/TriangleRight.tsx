import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Path } from '../parts/Path'

export class TriangleRight extends IconBase {
  static displayName = 'TriangleRightIcon'

  renderContent = (): React.ReactNode => (
    <Path
      d="M-50 -51.6L52 -0.2L-50 51.4V-51.6Z"
      fill={this.props.filled}
    />
  )
}
