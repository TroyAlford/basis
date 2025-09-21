import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class Markup extends IconBase {
  static displayName = 'MarkupIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <Path
          d="M-35 40L-76 0L-35 -40"
          data-name="left-caret"
          stroke={filled ? 20 : 10}
        />
        <Path
          d="M35 40L76 0L35 -40"
          data-name="right-caret"
          stroke={filled ? 20 : 10}
        />
        <Path
          d="M-10 50L10 -50"
          data-name="center-slash"
          stroke={filled ? 20 : 10}
        />
      </>
    )
  }
}
