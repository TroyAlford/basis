import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Path } from '../parts/Path'

export class Tag extends IconBase {
  static displayName = 'TagIcon'

  static path(filled = false): React.ReactElement<React.SVGProps<SVGPathElement>> {
    const hole = (
      <Path
        d="M-52.381 -45.2571Q-52.0762 -40.5333 -48.8762 -37.3333T-41.1048 -34.2857Q-36.2286 -34.2857 -33.181 -37.6381T-29.981 -45.2571Q-29.981 -50.2857 -33.4857 -53.4857T-41.1048 -56.5333Q-46.1333 -56.2286 -49.181 -53.0286T-52.381 -45.2571Z"
        data-name="hole"
        fill={filled}
        stroke={filled ? 0 : 10}
      />
    )
    const outline = (
      <Path
        d="M-71.4286 -20.2667V-64Q-71.1238 -68.7238 -67.7714 -72.2286T-59.8476 -75.581H-16.1143Q-2.7048 -74.6667 4.1524 -67.2L69.0667 4.7238Q71.9619 8.9905 71.9619 13.5619T69.0667 21.4857L18.1714 72.381Q14.3619 75.581 9.4857 75.581T1.5619 72.381L-63.0476 0Q-71.4286 -9.7524 -71.4286 -20.2667Z"
        data-name="outline"
        fill={filled}
        mask={filled ? 'url(#basis:icon:tag:mask:hole)' : undefined}
        stroke={10}
      />
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:tag:mask:hole">
              <rect
                fill="white"
                height={200}
                width={200}
                x={-100}
                y={-100}
              />
              {hole}
            </mask>
          </defs>
          {outline}
        </>
      )
    }

    return (
      <>
        {outline}
        {hole}
      </>
    )
  }

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    return Tag.path(filled)
  }
}
