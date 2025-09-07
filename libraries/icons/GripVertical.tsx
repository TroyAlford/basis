import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class GripVertical extends IconBase {
  static displayName = 'GripVerticalIcon'
  renderContent = (): React.ReactNode => (
    <>
      <circle cx={110} cy={150} r={20} />
      <circle cx={190} cy={150} r={20} />
      <circle cx={110} cy={65} r={20} />
      <circle cx={190} cy={65} r={20} />
      <circle cx={110} cy={235} r={20} />
      <circle cx={190} cy={235} r={20} />
    </>
  )
  viewBox = '0 0 300 300'
}
