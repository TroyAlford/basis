import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class LogOut extends IconBase {
  static displayName = 'LogOutIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <Path
          d="M-7.6333 -11.6H47.4333V-35.2L84.2333 0.2667L47.4333 35.4667V11.8667H-7.6333Z"
          data-name="arrow"
          fill={filled}
          stroke={filled ? 5 : 10}
        />
        <Path
          d="M15.3 33.0667L29.4333 47.3333Q8.6333 66.8 -15.6333 66.8Q-44.5667 66.8 -64.3 47.7333T-84.1667 -0.1333Q-84.1667 -18.1333 -75.1 -33.4667T-50.5667 -57.7333T-17.2333 -66.5333Q7.3 -66.5333 29.3 -46.8L15.3 -32.6667Q0.1 -46.5333 -17.1 -46.5333Q-36.9667 -46.5333 -50.5667 -32.6667T-64.3 1.2Q-64.3 19.8667 -50.1667 33.3333T-17.2333 46.8Q0.2333 46.8 15.3 33.0667Z"
          data-name="circle"
          fill={filled}
          stroke={filled ? 5 : 10}
        />
      </>
    )
  }
}
