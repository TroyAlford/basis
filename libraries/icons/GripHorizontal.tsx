import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class GripHorizontal extends IconBase {
  static displayName = 'GripHorizontalIcon'
  renderContent = (): React.ReactNode => (
    <>
      <circle cx={150} cy={110} r={20} />
      <circle cx={150} cy={190} r={20} />
      <circle cx={65} cy={110} r={20} />
      <circle cx={65} cy={190} r={20} />
      <circle cx={235} cy={110} r={20} />
      <circle cx={235} cy={190} r={20} />
    </>
  )
  viewBox = '0 0 300 300'
}
