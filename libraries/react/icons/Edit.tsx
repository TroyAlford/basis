import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'
import { Rect } from './parts/Rect'

export class Edit extends IconBase {
  static displayName = 'EditIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const pencil = <Path d="M0 30 L75 -50 L55 -70 L-20 10 L-20 30 Z" data-name="pencil" fill={filled} />
    const lines = <Path d="M-15 5 L5 25 M60 -35 L40 -55" data-name="pencil-lines" stroke={5} />

    const pencilMask = this.mask('pencil', React.cloneElement(pencil, { stroke: 30 }))
    const linesMask = this.mask('lines', lines)

    const square = (
      <Rect
        data-name="square"
        fill={filled}
        height={105}
        mask={pencilMask.props.url}
        stroke={10}
        width={105}
        x={-60}
        y={-35}
      />
    )

    return (
      <>
        <defs>
          {pencilMask}
          {linesMask}
        </defs>
        {square}
        {React.cloneElement(pencil, { mask: filled ? linesMask.props.url : undefined })}
        {!filled && lines}
      </>
    )

  }
}
