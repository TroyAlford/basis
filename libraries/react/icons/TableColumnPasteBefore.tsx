import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class TableColumnPasteBefore extends IconBase {
  static displayName = 'TableColumnPasteBeforeIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M0 -91.6667C10.8854 -91.6667 20.146 -84.7096 23.5777 -74.9993L50 -75C58.7863 -75 65.9847 -68.201 66.621 -59.5772L66.6667 -58.3333V50C66.6667 58.7863 59.8677 65.9847 51.2439 66.621L50 66.6667H-8.3333V50H50V-58.3333H33.3333V-50C33.3333 -45.3976 29.6024 -41.6667 25 -41.6667H-25C-29.6024 -41.6667 -33.3333 -45.3976 -33.3333 -50V-58.3333H-50V-41.6667H-66.6667V-58.3333C-66.6667 -67.1197 -59.8677 -74.318 -51.2439 -74.9543L-50 -75L-23.5777 -74.9993C-20.146 -84.7096 -10.8854 -91.6667 0 -91.6667ZM-16.6667 -33.3333V66.6667H-66.6667V-33.3333H-16.6667ZM-29.1667 -20.8333H-54.1667V54.1667H-29.1667V-20.8333ZM0 -75C-4.6024 -75 -8.3333 -71.269 -8.3333 -66.6667C-8.3333 -62.0643 -4.6024 -58.3333 0 -58.3333C4.6024 -58.3333 8.3333 -62.0643 8.3333 -66.6667C8.3333 -71.269 4.6024 -75 0 -75Z"
        data-name="table-column-paste-before"
        fill={filled}
        fillRule="evenodd"
      />
    )
  }
}
