import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class ZoomOut extends IconBase {
  static displayName = 'ZoomOutIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M62.5 -18.75C62.5 -0.8203 56.6797 15.7422 46.875 29.1797L96.3281 78.6719C101.2109 83.5547 101.2109 91.4844 96.3281 96.3672S83.5156 101.25 78.6328 96.3672L29.1797 46.875C15.7422 56.6797 -0.8203 62.5 -18.75 62.5C-63.6328 62.5 -100 26.1328 -100 -18.75S-63.6328 -100 -18.75 -100S62.5 -63.6328 62.5 -18.75ZM-46.875 -28.125C-52.0703 -28.125 -56.25 -23.9453 -56.25 -18.75S-52.0703 -9.375 -46.875 -9.375H9.375C14.5703 -9.375 18.75 -13.5547 18.75 -18.75S14.5703 -28.125 9.375 -28.125H-46.875Z"
        data-name="magnifying-glass-minus"
        fill={filled}
      />
    )
  }
}
