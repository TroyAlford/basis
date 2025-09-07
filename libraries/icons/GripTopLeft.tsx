import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class GripTopLeft extends IconBase {
  static displayName = 'GripTopLeftIcon'
  renderContent = (): React.ReactNode => (
    <>
      <circle cx={-50} cy={-50} r={14} />
      <circle cx={0} cy={0} r={14} />
      <circle cx={-50} cy={0} r={14} />
      <circle cx={0} cy={-50} r={14} />
      <circle cx={50} cy={-50} r={14} />
      <circle cx={-50} cy={50} r={14} />
    </>
  )
}
