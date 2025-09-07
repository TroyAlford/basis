import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class GripTopRight extends IconBase {
  static displayName = 'GripTopRightIcon'
  renderContent = (): React.ReactNode => (
    <>
      <circle cx={0} cy={0} r={14} />
      <circle cx={50} cy={50} r={14} />
      <circle cx={50} cy={0} r={14} />
      <circle cx={0} cy={-50} r={14} />
      <circle cx={50} cy={-50} r={14} />
      <circle cx={-50} cy={-50} r={14} />
    </>
  )
}
