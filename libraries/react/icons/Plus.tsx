import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class Plus extends IconBase {
  static displayName = 'PlusIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M71.25 -17.8125H17.8125V-71.25C17.8125 -77.8072 12.4947 -83.125 5.9375 -83.125H-5.9375C-12.4947 -83.125 -17.8125 -77.8072 -17.8125 -71.25V-17.8125H-71.25C-77.8072 -17.8125 -83.125 -12.4947 -83.125 -5.9375V5.9375C-83.125 12.4947 -77.8072 17.8125 -71.25 17.8125H-17.8125V71.25C-17.8125 77.8072 -12.4947 83.125 -5.9375 83.125H5.9375C12.4947 83.125 17.8125 77.8072 17.8125 71.25V17.8125H71.25C77.8072 17.8125 83.125 12.4947 83.125 5.9375V-5.9375C83.125 -12.4947 77.8072 -17.8125 71.25 -17.8125Z"
        data-name="plus"
        fill={filled}
      />
    )
  }
}
