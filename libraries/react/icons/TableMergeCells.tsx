import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class TableMergeCells extends IconBase {
  static displayName = 'TableMergeCellsIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M58.3333 -66.6667C67.5381 -66.6667 75 -59.2047 75 -50V50C75 59.2047 67.5381 66.6667 58.3333 66.6667H-58.3333C-67.5381 66.6667 -75 59.2047 -75 50V-50C-75 -59.2047 -67.5381 -66.6667 -58.3333 -66.6667H58.3333ZM-58.3333 29.1667V50H-33.3333V29.1667H-58.3333ZM58.3333 -12.5H-16.6667V50H58.3333V-12.5ZM58.3333 -50H25V-29.1667H58.3333V-50ZM-33.3333 -50H-58.3333V-29.1667H-33.3333V-50ZM8.3333 -50H-16.6667V-29.1667H8.3333V-50ZM-58.3333 12.5H-33.3333V-12.5H-58.3333V12.5Z"
        data-name="table-merge-cells"
        fill={filled}
        fillRule="evenodd"
      />
    )
  }
}
