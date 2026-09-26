import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class Superscript extends IconBase {
  static displayName = 'SuperscriptIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <Path
          d="M25 -21.5833L-13.25 16.6667L25 54.9167L13.25 66.6667L-25 28.4167L-63.25 66.6667L-75 54.9167L-36.75 16.6667L-75 -21.5833L-63.25 -33.3333L-25 4.9167L13.25 -33.3333L25 -21.5833Z"
          data-name="superscript-0"
          fill={filled}
          fillRule="evenodd"
        />
        <Path
          d="M73.75 -8.3333H33.0833V-16.6667L40.5 -23.5C46.8333 -28.8333 51.5 -33.3333 54.6667 -37.0833C57.75 -40.75 59.3333 -44.1667 59.4167 -47.3333C59.5 -49.6667 58.75 -51.6667 57.1667 -53.1667C55.6667 -54.75 53.25 -55.5 50 -55.5833C47.4167 -55.5 45.1667 -55 43 -54.1667L37.5 -50.9167L33.75 -60.6667C36 -62.5 38.6667 -63.9167 41.9167 -65.0833C45.1667 -66.25 48.75 -66.6667 52.6667 -66.6667C59.1667 -66.6667 64.1667 -65 67.5 -61.5833C70.8333 -58.3333 72.6667 -53.8333 72.6667 -48.5C72.5833 -43.8333 71.0833 -39.5 68.1667 -35.5833C65.3333 -31.5833 61.8333 -27.8333 57.5833 -24.25L52.25 -19.9167V-19.75H73.75V-8.3333Z"
          data-name="superscript-1"
          fill={filled}
          fillRule="evenodd"
        />
      </>
    )
  }
}
