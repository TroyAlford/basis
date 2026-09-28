import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class Print extends IconBase {
  static displayName = 'PrintIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M-75 -75C-75 -88.7891 -63.7891 -100 -50 -100H33.3984C40.0391 -100 46.4063 -97.3828 51.0938 -92.6953L67.6953 -76.0937C72.3828 -71.4062 75 -65.0391 75 -58.3984V-43.75H-75V-75ZM-100 0C-100 -13.7891 -88.7891 -25 -75 -25H75C88.7891 -25 100 -13.7891 100 0V37.5C100 44.4141 94.4141 50 87.5 50H75V75C75 88.7891 63.7891 100 50 100H-50C-63.7891 100 -75 88.7891 -75 75V50H-87.5C-94.4141 50 -100 44.4141 -100 37.5V0ZM-50 62.5V75H50V37.5H-50V62.5ZM78.125 6.25C78.125 -0.9669 70.3125 -5.4774 64.0625 -1.869C61.1619 -0.1943 59.375 2.9006 59.375 6.25C59.375 13.4669 67.1875 17.9774 73.4375 14.369C76.3381 12.6943 78.125 9.5994 78.125 6.25Z"
        data-name="print"
        fill={filled}
      />
    )
  }
}
