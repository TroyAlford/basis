import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class GripHorizontal extends IconBase {
  static displayName = 'GripHorizontalIcon'
  renderContent = (): React.ReactNode => (
    <>
      <circle cx={0} cy={-26.66666666666667} r={13.333333333333332} />
      <circle cx={0} cy={26.666666666666657} r={13.333333333333332} />
      <circle cx={-56.66666666666667} cy={-26.66666666666667} r={13.333333333333332} />
      <circle cx={-56.66666666666667} cy={26.666666666666657} r={13.333333333333332} />
      <circle cx={56.66666666666666} cy={-26.66666666666667} r={13.333333333333332} />
      <circle cx={56.66666666666666} cy={26.666666666666657} r={13.333333333333332} />
    </>
  )
}
