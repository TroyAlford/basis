import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class AlignCenter extends IconBase {
  static displayName = 'AlignCenterIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <Path
          d="M-58.3333 -58.3333H58.3333C62.9357 -58.3333 66.6667 -54.6024 66.6667 -50H66.6667C66.6667 -45.3976 62.9357 -41.6667 58.3333 -41.6667H-58.3333C-62.9357 -41.6667 -66.6667 -45.3976 -66.6667 -50H-66.6667C-66.6667 -54.6024 -62.9357 -58.3333 -58.3333 -58.3333Z"
          data-name="align-center-0"
          fill={filled}
          fillRule="evenodd"
        />
        <Path
          d="M-33.3333 -25H33.3333C37.9357 -25 41.6667 -21.269 41.6667 -16.6667H41.6667C41.6667 -12.0643 37.9357 -8.3333 33.3333 -8.3333H-33.3333C-37.9357 -8.3333 -41.6667 -12.0643 -41.6667 -16.6667H-41.6667C-41.6667 -21.269 -37.9357 -25 -33.3333 -25Z"
          data-name="align-center-1"
          fill={filled}
          fillRule="evenodd"
        />
        <Path
          d="M-33.3333 41.6667H33.3333C37.9357 41.6667 41.6667 45.3976 41.6667 50H41.6667C41.6667 54.6024 37.9357 58.3333 33.3333 58.3333H-33.3333C-37.9357 58.3333 -41.6667 54.6024 -41.6667 50H-41.6667C-41.6667 45.3976 -37.9357 41.6667 -33.3333 41.6667Z"
          data-name="align-center-2"
          fill={filled}
          fillRule="evenodd"
        />
        <Path
          d="M-58.3333 8.3333H58.3333C62.9357 8.3333 66.6667 12.0643 66.6667 16.6667H66.6667C66.6667 21.269 62.9357 25 58.3333 25H-58.3333C-62.9357 25 -66.6667 21.269 -66.6667 16.6667H-66.6667C-66.6667 12.0643 -62.9357 8.3333 -58.3333 8.3333Z"
          data-name="align-center-3"
          fill={filled}
          fillRule="evenodd"
        />
      </>
    )
  }
}
