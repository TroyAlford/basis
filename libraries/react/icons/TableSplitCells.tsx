import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class TableSplitCells extends IconBase {
  static displayName = 'TableSplitCellsIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M58.3333 -66.6667C67.5381 -66.6667 75 -59.2047 75 -50V50C75 59.2047 67.5381 66.6667 58.3333 66.6667H-58.3333C-67.5381 66.6667 -75 59.2047 -75 50V-50C-75 -59.2047 -67.5381 -66.6667 -58.3333 -66.6667H58.3333ZM-33.3333 29.1667H-58.3333V50H-33.3333V29.1667ZM58.3333 -12.5H-16.6667V50H58.3333V-12.5ZM37.2472 -4.4194L46.0861 4.4194L29.675 20.8333L46.0861 37.2472L37.2472 46.0861L20.8333 29.675L4.4194 46.0861L-4.4194 37.2472L11.9917 20.8333L-4.4194 4.4194L4.4194 -4.4194L20.8333 11.9917L37.2472 -4.4194ZM-33.3333 -12.5H-58.3333V12.5H-33.3333V-12.5ZM58.3333 -50H25V-29.1667H58.3333V-50ZM-33.3333 -50H-58.3333V-29.1667H-33.3333V-50ZM8.3333 -50H-16.6667V-29.1667H8.3333V-50Z"
        data-name="table-split-cells"
        fill={filled}
        fillRule="evenodd"
      />
    )
  }
}
