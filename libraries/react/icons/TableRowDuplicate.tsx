import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class TableRowDuplicate extends IconBase {
  static displayName = 'TableRowDuplicateIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M83.3333 -8.3333V50H-50V-8.3333H83.3333ZM66.6667 8.3333H-33.3333V33.3333H66.6667V8.3333ZM58.3333 -41.6667V-25H-66.6667V16.6667H-83.3333V-41.6667H58.3333Z"
        data-name="table-row-duplicate"
        fill={filled}
        fillRule="evenodd"
      />
    )
  }
}
