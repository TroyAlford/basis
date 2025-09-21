import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class Menu extends IconBase {
  static displayName = 'MenuIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    return (
      <Path
        d="M69.62 40V51.36Q69.62 53.76 68.02 55.36T63.86 57.12H-61.74Q-64.14 57.12 -65.74 55.36T-67.5 51.36V40Q-67.5 37.6 -65.74 36T-61.74 34.24H63.86Q66.26 34.24 68.02 36T69.62 40ZM69.62 -5.76V5.76Q69.62 8 68.02 9.76T63.86 11.36H-61.74Q-64.14 11.36 -65.74 9.76T-67.5 5.76V-5.76Q-67.5 -8 -65.74 -9.76T-61.74 -11.36H63.86Q66.26 -11.36 68.02 -9.76T69.62 -5.76ZM69.62 -51.36V-40Q69.62 -37.76 68.02 -36T63.86 -34.24H-61.74Q-64.14 -34.24 -65.74 -36T-67.5 -40V-51.36Q-67.5 -53.76 -65.74 -55.52T-61.74 -57.12H63.86Q66.26 -57.12 68.02 -55.52T69.62 -51.36Z"
        fill={filled}
      />
    )
  }
}
