import * as React from 'react'
import type { IconProps } from './IconBase/IconBase'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'
import { SquareCheck } from './SquareCheck'
import { SquareDash } from './SquareDash'
import { SquareX } from './SquareX'
import { LineJoin } from './types/LineJoin'

enum Variant {
  Check = 'Check',
  Dash = 'Dash',
  X = 'X',
}

type Props = IconProps<{
  /** The square variant */
  variant?: Variant | keyof typeof Variant,
}>

export class Square extends IconBase<Props> {
  static displayName = 'Square'
  static Variant = Variant
  static get defaultProps() {
    return {
      ...super.defaultProps,
      variant: undefined, // Default to simple square
    }
  }

  static X = SquareX
  static Dash = SquareDash
  static Check = SquareCheck

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    return (
      <Path
        d="M-65 -65 L65 -65 L65 65 L-65 65 L-65 -65 Z"
        fill={filled}
        lineJoin={LineJoin.Bevel}
      />
    )
  }
}
