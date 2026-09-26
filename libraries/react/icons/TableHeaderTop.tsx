import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class TableHeaderTop extends IconBase {
  static displayName = 'TableHeaderTopIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M58.3333 -66.6667C67.5381 -66.6667 75 -59.2047 75 -50V50C75 59.2047 67.5381 66.6667 58.3333 66.6667H-58.3333C-67.5381 66.6667 -75 59.2047 -75 50V-50C-75 -59.2047 -67.5381 -66.6667 -58.3333 -66.6667H58.3333ZM-8.3333 25H-58.3333V50H-8.3333V25ZM58.3333 25H8.3333V50H58.3333V25ZM58.3333 -16.6667H8.3333V8.3333H58.3333V-16.6667ZM-58.3333 8.3333H-8.3333V-16.6667H-58.3333V8.3333Z"
        data-name="table-header-top"
        fill={filled}
        fillRule="evenodd"
      />
    )
  }
}
