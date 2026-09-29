import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class HorizontalRule extends IconBase {
  static displayName = 'HorizontalRuleIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M-60.6667 -6.0000H60.6667A6.0000 6.0000 0 0 1 66.6667 0.0000V0.0000A6.0000 6.0000 0 0 1 60.6667 6.0000H-60.6667A6.0000 6.0000 0 0 1 -66.6667 0.0000V0.0000A6.0000 6.0000 0 0 1 -60.6667 -6.0000Z"
        data-name="horizontal-rule"
        fill={filled}
        fillRule="evenodd"
        stroke={filled ? 0 : 10}
      />
    )
  }
}
