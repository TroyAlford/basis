import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class Chart extends IconBase {
  static displayName = 'ChartIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M-25 -68.75C-25 -79.1016 -16.6016 -87.5 -6.25 -87.5H6.25C16.6016 -87.5 25 -79.1016 25 -68.75V68.75C25 79.1016 16.6016 87.5 6.25 87.5H-6.25C-16.6016 87.5 -25 79.1016 -25 68.75V-68.75ZM-100 6.25C-100 -4.1016 -91.6016 -12.5 -81.25 -12.5H-68.75C-58.3984 -12.5 -50 -4.1016 -50 6.25V68.75C-50 79.1016 -58.3984 87.5 -68.75 87.5H-81.25C-91.6016 87.5 -100 79.1016 -100 68.75V6.25ZM68.75 -62.5H81.25C91.6016 -62.5 100 -54.1016 100 -43.75V68.75C100 79.1016 91.6016 87.5 81.25 87.5H68.75C58.3984 87.5 50 79.1016 50 68.75V-43.75C50 -54.1016 58.3984 -62.5 68.75 -62.5Z"
        data-name="chart"
        fill={filled}
      />
    )
  }
}
