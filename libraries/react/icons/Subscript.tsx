import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class Subscript extends IconBase {
  static displayName = 'SubscriptIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <>
        <Path
          d="M-13.25 -16.6667L25 21.5833L13.25 33.3333L-25 -4.9167L-63.25 33.3333L-75 21.5833L-36.75 -16.6667L-75 -54.9167L-63.25 -66.6667L-25 -28.4167L13.25 -66.6667L25 -54.9167L-13.25 -16.6667Z"
          data-name="subscript-0"
          fill={filled}
          fillRule="evenodd"
        />
        <Path
          d="M73.75 58.5833H33.0833V50.25L40.5 43.5833C46.8333 38.1667 51.5 33.6667 54.6667 30C57.75 26.3333 59.3333 22.9167 59.4167 19.6667C59.5 17.3333 58.75 15.4167 57.1667 13.8333C55.6667 12.5 53.25 11.5 50 11.5C47.4167 11.5 45.1667 12 43 13L37.5 16.1667L33.75 6.4167C36 4.6667 38.6667 3.1667 41.9167 2C45.1667 0.8333 48.75 0 52.6667 0C59.1667 0.3333 64.1667 2.0833 67.5 5.5C70.8333 8.9167 72.6667 13.25 72.6667 18.5833C72.5833 23.25 71.0833 27.5833 68.1667 31.5C65.3333 35.4167 61.8333 39.1667 57.5833 42.8333L52.25 47.1667L73.75 47.3333V58.5833Z"
          data-name="subscript-1"
          fill={filled}
          fillRule="evenodd"
        />
      </>
    )
  }
}
