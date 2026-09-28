import * as React from 'react'
import type { IconProps } from './IconBase/IconBase'
import { IconBase } from './IconBase/IconBase'
import { ZoomIn } from './ZoomIn'
import { ZoomOut } from './ZoomOut'

enum Direction {
  In = 'In',
  Out = 'Out',
}

type Props = IconProps<{
  /** The zoom direction */
  direction?: Direction | keyof typeof Direction,
}>

export class Zoom extends IconBase<Props> {
  static displayName = 'Zoom'
  static Direction = Direction
  static get defaultProps() {
    return {
      ...super.defaultProps,
      direction: Direction.In,
    }
  }

  static In = ZoomIn
  static Out = ZoomOut

  // Override Render instead of renderContent, so we don't get nesting
  render = (): React.ReactNode => {
    const { direction, ...props } = this.props

    return direction === Direction.Out
      ? <ZoomOut {...props} />
      : <ZoomIn {...props} />
  }
}
