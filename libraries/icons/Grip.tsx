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

  // Override Render instead of renderContent, so we don't get nesting
  render = (): React.ReactNode => {
    const { orientation, ...props } = this.props

    switch (orientation) {
      case Orientation.Vertical: return <GripVertical {...props} />
      case Orientation.TopRight: return <GripTopRight {...props} />
      case Orientation.TopLeft: return <GripTopLeft {...props} />
      case Orientation.BottomRight: return <GripBottomRight {...props} />
      case Orientation.BottomLeft: return <GripBottomLeft {...props} />
      case Orientation.Horizontal: default: return <GripHorizontal {...props} />
    }
  }
}
