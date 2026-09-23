import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class HorizontalRule extends IconBase {
  static displayName = 'HorizontalRuleIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M-66.6667 -8.3333H66.6667V8.3333H-66.6667Z"
        data-name="horizontal-rule"
        fill={filled}
        fillRule="evenodd"
      />
    )
  }
}
