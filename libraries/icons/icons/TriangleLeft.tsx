import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Path } from '../parts/Path'

export class TriangleLeft extends IconBase {
  static displayName = 'TriangleLeftIcon'

  renderContent = (): React.ReactNode => (
    <Path
      d="M52 -51.6L-50 -0.2L52 51.4V-51.6Z"
      fill={this.props.filled}
    />
  )
}
