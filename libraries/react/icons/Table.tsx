import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class Table extends IconBase {
  static displayName = 'TableIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M58.3333 -66.6667C67.5381 -66.6667 75 -59.2047 75 -50V50C75 59.2047 67.5381 66.6667 58.3333 66.6667H-58.3333C-67.5381 66.6667 -75 59.2047 -75 50V-50C-75 -59.2047 -67.5381 -66.6667 -58.3333 -66.6667H58.3333ZM-58.3333 16.6667V50H-8.3333V16.6667H-58.3333ZM58.3333 16.6667H8.3333V50H58.3333V16.6667ZM58.3333 -33.3333H8.3333V0H58.3333V-33.3333ZM-58.3333 0H-8.3333V-33.3333H-58.3333V0Z"
        data-name="table"
        fill={filled}
        fillRule="evenodd"
      />
    )
  }
}
