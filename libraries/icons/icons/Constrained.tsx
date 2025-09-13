import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Path } from '../parts/Path'
import { LineCap } from '../types/LineCap'
import { LineJoin } from '../types/LineJoin'

export class Constrained extends IconBase {
  static displayName = 'ConstrainedIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    const stroke = filled ? 15 : 10

    return (
      <g strokeLinecap={LineCap.Round} strokeLinejoin={LineJoin.Round}>
        <Path d="M75 -41.6667V41.6667" stroke={stroke} />
        <Path d="M-75 -41.6667V41.6667" stroke={stroke} />
        <Path d="M-41.6667 0H41.6667M-41.6667 0L-20.8333 -20.8333M-41.6667 0L-20.8333 20.8333M41.6667 0L20.8333 -20.8333M41.6667 0L20.8333 20.8333" stroke={stroke} />
      </g>
    )
  }
}
