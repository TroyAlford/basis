import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Info extends IconBase {
  static displayName = 'InfoIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const circle = (
      <path
        d="M69.62 0Q69.62 18.72 60.5 34.4T35.54 59.36T1.14 68.64T-33.42 59.36T-58.22 34.4T-67.5 0T-58.22 -34.4T-33.42 -59.36T1.14 -68.64T35.54 -59.36T60.5 -34.4T69.62 0Z"
        data-name="circle"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        mask={filled ? 'url(#basis:icon:info:mask:letter)' : undefined}
        strokeWidth="10"
      />
    )

    const letter = (
      <path
        d="M23.86 42.88V28.64Q23.86 27.36 23.06 26.56T21.14 25.76H12.5V-20Q12.5 -21.28 11.7 -22.08T9.62 -22.88H-18.86Q-20.14 -22.88 -20.94 -22.08T-21.74 -20V-5.76Q-21.74 -4.48 -20.94 -3.68T-18.86 -2.88H-10.38V25.76H-18.86Q-20.14 25.76 -20.94 26.56T-21.74 28.64V42.88Q-21.74 44.16 -20.94 44.96T-18.86 45.76H21.14Q22.26 45.76 23.06 44.96T23.86 42.88ZM12.5 -37.12V-51.36Q12.5 -52.64 11.7 -53.44T9.62 -54.24H-7.5Q-8.78 -54.24 -9.58 -53.44T-10.38 -51.36V-37.12Q-10.38 -35.84 -9.58 -35.04T-7.5 -34.24H9.62Q10.9 -34.24 11.7 -35.04T12.5 -37.12Z"
        data-name="letter"
        fill={filled ? 'black' : 'var(--basis-icon-color)'}
      />
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:info:mask:letter">
              <rect
                fill="white"
                height="200"
                width="200"
                x="-100"
                y="-100"
              />
              {letter}
            </mask>
          </defs>
          {circle}
        </>
      )
    }

    return (
      <>
        {circle}
        {letter}
      </>
    )
  }
}
