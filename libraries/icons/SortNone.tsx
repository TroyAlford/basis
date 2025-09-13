import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class SortNone extends IconBase {
  static displayName = 'SortNoneIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    return (
      <Path
        d="M-49.1103 -11.8753H49.1181C58.2471 -11.8753 62.8078 -22.9264 56.3693 -29.3612L7.2737 -80.1268C5.2675 -82.133 2.6461 -83.1352 0.0261 -83.1352C-2.5919 -83.1352 -5.2026 -82.133 -7.1916 -80.1268L-56.3619 -29.3537C-62.7997 -22.9338 -58.2411 -11.8753 -49.1103 -11.8753ZM49.0959 11.8747H-49.1103C-58.2393 11.8747 -62.8 22.9222 -56.3615 29.3607L-7.1916 80.1263C-5.2322 82.1228 -2.9314 83.1247 0.0002 83.1247C2.6175 83.1247 5.24 82.1216 7.2476 80.1155L56.3434 29.3499C62.7893 22.9333 58.2248 11.8747 49.0959 11.8747Z"
        fill={filled}
        stroke={10}
      />
    )
  }
}
