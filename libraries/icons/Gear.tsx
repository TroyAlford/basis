import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Gear extends IconBase {
  static displayName = 'GearIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const gearShape = (
      <path
        d="M15.4929 -80.1024H-16.466L-25.6851 -43.6363L-61.7413 -54.0845L-77.9257 -26.2228L-50.6785 0L-77.9257 26.0179L-61.7413 53.6747L-25.6851 43.4315L-16.466 79.8976H15.4929L24.5071 43.4315L60.9731 53.6747L76.7477 26.0179L49.7054 0L76.7477 -26.2228L60.9731 -54.0845L24.5071 -43.6363Z"
        data-name="gear-shape"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        strokeWidth={filled ? undefined : '10'}
      />
    )

    const circle = (
      <circle
        cx="0"
        cy="0"
        data-name="circle"
        fill={filled ? 'black' : 'transparent'}
        r="19.8"
        strokeWidth={filled ? undefined : '10'}
      />
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:gear:mask:circle">
              <rect
                fill="white"
                height="200"
                width="200"
                x="-100"
                y="-100"
              />
              {React.cloneElement(circle, { fill: 'black', strokeWidth: undefined })}
            </mask>
          </defs>
          {React.cloneElement(gearShape, { mask: 'url(#basis:icon:gear:mask:circle)' })}
        </>
      )
    }

    return (
      <>
        {gearShape}
        {circle}
      </>
    )
  }
}
