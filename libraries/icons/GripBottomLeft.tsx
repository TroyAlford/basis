import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class GripBottomLeft extends IconBase {
  static displayName = 'GripBottomLeftIcon'
  renderContent = (): React.ReactNode => (
    <>
      <circle cx={250} cy={250} r={35} />
      <circle cx={375} cy={375} r={35} />
      <circle cx={125} cy={250} r={35} />
      <circle cx={250} cy={375} r={35} />
      <circle cx={125} cy={125} r={35} />
      <circle cx={125} cy={375} r={35} />
    </>
  )
  viewBox = '0 0 500 500'
}
