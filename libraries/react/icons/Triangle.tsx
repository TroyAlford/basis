import * as React from 'react'
import type { IconProps } from './IconBase/IconBase'
import { IconBase } from './IconBase/IconBase'
import { TriangleDown } from './TriangleDown'
import { TriangleLeft } from './TriangleLeft'
import { TriangleRight } from './TriangleRight'
import { TriangleUp } from './TriangleUp'

enum Orientation {
  Down = 'Down',
  Left = 'Left',
  Right = 'Right',
  Up = 'Up',
}

type Props = IconProps<{
  /** The triangle orientation */
  orientation?: Orientation | keyof typeof Orientation,
}>

export class Triangle extends IconBase<Props> {
  static displayName = 'Triangle'
  static Orientation = Orientation
  static get defaultProps() {
    return {
      ...super.defaultProps,
      orientation: Orientation.Right,
    }
  }

  static Right = TriangleRight
  static Down = TriangleDown
  static Left = TriangleLeft
  static Up = TriangleUp

  // Override Render instead of renderContent, so we don't get nesting
  render = (): React.ReactNode => {
    const { orientation, ...props } = this.props

    switch (orientation) {
      case Orientation.Down: return <TriangleDown {...props} />
      case Orientation.Left: return <TriangleLeft {...props} />
      case Orientation.Up: return <TriangleUp {...props} />
      case Orientation.Right: default: return <TriangleRight {...props} />
    }
  }
}
