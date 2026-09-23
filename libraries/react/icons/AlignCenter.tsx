import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'

export class AlignCenter extends IconBase {
  static displayName = 'AlignCenterIcon'

  renderContent = (): React.ReactNode => (
    <>
      <Path
        fill
        d="M-60.6667 -56.0000H60.6667A6.0000 6.0000 0 0 1 66.6667 -50.0000V-50.0000A6.0000 6.0000 0 0 1 60.6667 -44.0000H-60.6667A6.0000 6.0000 0 0 1 -66.6667 -50.0000V-50.0000A6.0000 6.0000 0 0 1 -60.6667 -56.0000Z"
        data-name="align-center-0"
        fillRule="evenodd"
        stroke={0}
      />
      <Path
        fill
        d="M-35.6667 -22.6667H35.6667A6.0000 6.0000 0 0 1 41.6667 -16.6667V-16.6667A6.0000 6.0000 0 0 1 35.6667 -10.6667H-35.6667A6.0000 6.0000 0 0 1 -41.6667 -16.6667V-16.6667A6.0000 6.0000 0 0 1 -35.6667 -22.6667Z"
        data-name="align-center-1"
        fillRule="evenodd"
        stroke={0}
      />
      <Path
        fill
        d="M-35.6667 44.0000H35.6667A6.0000 6.0000 0 0 1 41.6667 50.0000V50.0000A6.0000 6.0000 0 0 1 35.6667 56.0000H-35.6667A6.0000 6.0000 0 0 1 -41.6667 50.0000V50.0000A6.0000 6.0000 0 0 1 -35.6667 44.0000Z"
        data-name="align-center-2"
        fillRule="evenodd"
        stroke={0}
      />
      <Path
        fill
        d="M-60.6667 10.6666H60.6667A6.0000 6.0000 0 0 1 66.6667 16.6666V16.6666A6.0000 6.0000 0 0 1 60.6667 22.6666H-60.6667A6.0000 6.0000 0 0 1 -66.6667 16.6666V16.6666A6.0000 6.0000 0 0 1 -60.6667 10.6666Z"
        data-name="align-center-3"
        fillRule="evenodd"
        stroke={0}
      />
    </>
  )
}
