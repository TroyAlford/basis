import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class TableDelete extends IconBase {
  static displayName = 'TableDeleteIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <Path
          d="M58.3333 -66.6667C67.5381 -66.6667 75 -59.2047 75 -50V50C75 59.2047 67.5381 66.6667 58.3333 66.6667H-58.3333C-67.5381 66.6667 -75 59.2047 -75 50V-50C-75 -59.2047 -67.5381 -66.6667 -58.3333 -66.6667H58.3333ZM-58.3333 -50V50H58.3333V-50H-58.3333Z"
          data-name="table-delete-0"
          fill={filled}
          fillRule="evenodd"
        />
        <Path
          d="M19.9167 -28.75L28.75 -19.9167L8.8333 0L28.75 19.9167L19.9167 28.75L0 8.8333L-19.9167 28.75L-28.75 19.9167L-8.8333 0L-28.75 -19.9167L-19.9167 -28.75L0 -8.8333Z"
          data-name="table-delete-1"
          fill={filled}
          fillRule="evenodd"
        />
      </>
    )
  }
}
