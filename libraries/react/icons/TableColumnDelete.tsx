import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class TableColumnDelete extends IconBase {
  static displayName = 'TableColumnDeleteIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M58.3333 -66.6667C67.5381 -66.6667 75 -59.2047 75 -50V50C75 59.2047 67.5381 66.6667 58.3333 66.6667H-58.3333C-67.5381 66.6667 -75 59.2047 -75 50V-50C-75 -59.2047 -67.5381 -66.6667 -58.3333 -66.6667H58.3333ZM25 -33.3333H8.3333V-50H-8.3333V-33.3333H-25V-50H-58.3333V50H-25V33.3333H-8.3333V50H8.3333V33.3333H25V50H58.3333V-50H25V-33.3333ZM27.4129 -29.239L35.0871 -19.3721L10.175 0L35.0871 19.3721L27.4129 29.239L0 7.9167L-27.4129 29.239L-35.0871 19.3721L-10.1833 0L-35.0871 -19.3721L-27.4129 -29.239L0 -7.925L27.4129 -29.239Z"
        data-name="table-column-delete"
        fill={filled}
        fillRule="evenodd"
      />
    )
  }
}
