import * as React from 'react'
import { GripBottomLeft } from './GripBottomLeft'
import { GripBottomRight } from './GripBottomRight'
import { GripHorizontal } from './GripHorizontal'
import { GripTopLeft } from './GripTopLeft'
import { GripTopRight } from './GripTopRight'
import { GripVertical } from './GripVertical'
import type { IconProps } from './IconBase/IconBase'
import { IconBase } from './IconBase/IconBase'

export enum Orientation {
  BottomLeft = 'BottomLeft',
  BottomRight = 'BottomRight',
  Horizontal = 'Horizontal',
  TopLeft = 'TopLeft',
  TopRight = 'TopRight',
  Vertical = 'Vertical',
}

type Props = IconProps<{
  /** The grip orientation */
  orientation?: Orientation | keyof typeof Orientation,
}>

export class Grip extends IconBase<Props> {
  static displayName = 'Grip'
  static Orientation = Orientation
  static get defaultProps() {
    return {
      ...super.defaultProps,
      orientation: Orientation.Horizontal,
    }
  }

  static Horizontal = GripHorizontal
  static Vertical = GripVertical
  static TopLeft = GripTopLeft
  static TopRight = GripTopRight
  static BottomLeft = GripBottomLeft
  static BottomRight = GripBottomRight

  // Required abstract methods from IconBase
  renderContent = (): React.ReactNode => {
    const { orientation, ...props } = this.props

    switch (orientation) {
      case Orientation.Vertical:
      case 'Vertical': return <GripVertical {...props} />
      case Orientation.TopRight:
      case 'TopRight': return <GripTopRight {...props} />
      case Orientation.TopLeft:
      case 'TopLeft': return <GripTopLeft {...props} />
      case Orientation.BottomRight:
      case 'BottomRight': return <GripBottomRight {...props} />
      case Orientation.BottomLeft:
      case 'BottomLeft': return <GripBottomLeft {...props} />
      case Orientation.Horizontal:
      case 'Horizontal':
      default: return <GripHorizontal {...props} />
    }
  }
  readonly viewBox = '0 0 24 24'
}
