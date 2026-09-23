import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class TableHeaderLeft extends IconBase {
  static displayName = 'TableHeaderLeftIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M58.3333 -66.6667C67.5381 -66.6667 75 -59.2047 75 -50V50C75 59.2047 67.5381 66.6667 58.3333 66.6667H-58.3333C-67.5381 66.6667 -75 59.2047 -75 50V-50C-75 -59.2047 -67.5381 -66.6667 -58.3333 -66.6667H58.3333ZM58.3333 8.3333H25V50H58.3333V8.3333ZM8.3333 8.3333H-25V50H8.3333V8.3333ZM8.3333 -50H-25V-8.3333H8.3333V-50ZM58.3333 -50H25V-8.3333H58.3333V-50Z"
        data-name="table-header-left"
        fill={filled}
        fillRule="evenodd"
      />
    )
  }
}
