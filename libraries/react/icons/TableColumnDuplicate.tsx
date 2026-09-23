import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class TableColumnDuplicate extends IconBase {
  static displayName = 'TableColumnDuplicateIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M41.6667 -50V83.3333H-16.6667V-50H41.6667ZM25 -33.3333H-0.0083V66.6667H25V-33.3333ZM8.3333 -83.3333V-66.6667H-33.3417V58.3333H-50V-83.3333H8.3333Z"
        data-name="table-column-duplicate"
        fill={filled}
        fillRule="evenodd"
      />
    )
  }
}
