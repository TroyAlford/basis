import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'
import { LineCap } from './types/LineCap'
import { LineJoin } from './types/LineJoin'

export class SquareDash extends IconBase {
  static displayName = 'SquareDashIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const dash = (
      <Path
        d="M-30 0 L30 0"
        lineCap={LineCap.Round}
        stroke={15}
      />
    )
    const mask = this.mask('dash', dash)

    const square = (
      <Path
        // d="M-50 -70C-61.0312 -70 -70 -61.0312 -70 -50V50C-70 61.0313 -61.0312 70 -50 70H50C61.0313 70 70 61.0313 70 50V-50C70 -61.0312 61.0313 -70 50 -70H-50ZM-27.8125 -27.8125C-24.875 -30.75 -20.125 -30.75 -17.2187 -27.8125L-0.0312 -10.625L17.1563 -27.8125C20.0938 -30.75 24.8438 -30.75 27.75 -27.8125C30.6563 -24.875 30.6875 -20.125 27.75 -17.2187L10.5625 -0.0312L27.75 17.1563C30.6875 20.0938 30.6875 24.8438 27.75 27.75C24.8125 30.6563 20.0625 30.6875 17.1563 27.75L-0.0312 10.5625L-17.2187 27.75C-20.1562 30.6875 -24.9062 30.6875 -27.8125 27.75C-30.7187 24.8125 -30.75 20.0625 -27.8125 17.1563L-10.625 -0.0312L-27.8125 -17.2187C-30.75 -20.1562 -30.75 -24.9062 -27.8125 -27.8125Z"
        d="M-65 -65 L65 -65 L65 65 L-65 65 L-65 -65 Z"
        fill={filled}
        lineJoin={LineJoin.Bevel}
        mask={filled ? mask.props.url : undefined}
      />
    )
    return (
      <>
        <defs>{mask}</defs>
        {square}
        {!filled && dash}
      </>
    )
  }
}
