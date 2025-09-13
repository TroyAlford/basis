import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Path } from '../parts/Path'

/**
 * Star icon component with fill control.
 */
export class Star extends IconBase {
  static displayName = 'Star'

  renderContent = (): React.ReactNode => (
    <Path
      d="M0 -83.3333L25.75 -31.1667L83.3333 -22.75L41.6667 17.8333L51.5 75.1667L0 48.0833L-51.5 75.1667L-41.6667 17.8333L-83.3333 -22.75L-25.75 -31.1667L0 -83.3333Z"
      fill={this.props.filled}
      stroke={this.props.filled ? 0 : 10}
    />
  )
}
