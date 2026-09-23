import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class TableRowDelete extends IconBase {
  static displayName = 'TableRowDeleteIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M58.3333 -66.6667C67.5381 -66.6667 75 -59.2047 75 -50V50C75 59.2047 67.5381 66.6667 58.3333 66.6667H-58.3333C-67.5381 66.6667 -75 59.2047 -75 50V-50C-75 -59.2047 -67.5381 -66.6667 -58.3333 -66.6667H58.3333ZM58.3333 -50H-58.3333V-25H-37.5V-8.3333H-58.3333V8.3333H-37.5V25H-58.3333V50H58.3333V25H37.5V8.3333H58.3333V-8.3333H37.5V-25H58.3333V-50ZM19.3721 -35.0871L29.239 -27.4129L7.9167 0L29.239 27.4129L19.3721 35.0871L0 10.175L-19.3721 35.0871L-29.239 27.4129L-7.925 0L-29.239 -27.4129L-19.3721 -35.0871L0 -10.1833L19.3721 -35.0871Z"
        data-name="table-row-delete"
        fill={filled}
        fillRule="evenodd"
      />
    )
  }
}
