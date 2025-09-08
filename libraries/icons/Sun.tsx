import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Sun extends IconBase {
  static displayName = 'SunIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const rays = (
      <path
        d="M77 -4.8437L47.4063 -19.625L57.875 -51C59.2813 -55.25 55.25 -59.2813 51.0313 -57.8438L19.6563 -47.375L4.8438 -77C2.8438 -81 -2.8437 -81 -4.8437 -77L-19.625 -47.4063L-51.0312 -57.875C-55.2812 -59.2812 -59.3125 -55.25 -57.875 -51.0312L-47.4062 -19.6562L-77 -4.8437C-81 -2.8437 -81 2.8438 -77 4.8438L-47.4062 19.625L-57.875 51.0313C-59.2812 55.2813 -55.25 59.3125 -51.0312 57.875L-19.6562 47.4063L-4.875 77C-2.875 81 2.8125 81 4.8125 77L19.5938 47.4063L50.9688 57.875C55.2188 59.2813 59.25 55.25 57.8125 51.0313L47.3438 19.6563L76.9375 4.875C81 2.8437 81 -2.8437 77 -4.8438Z"
        data-name="rays"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        mask={filled ? 'url(#basis:icon:sun:mask:center)' : undefined}
        strokeWidth="10"
      />
    )

    const corona = (
      <circle
        cx="0"
        cy="0"
        data-name="corona"
        fill="transparent"
        r="30"
        strokeWidth="10"
      />
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:sun:mask:center">
              <rect
                fill="white"
                height="200"
                width="200"
                x="-100"
                y="-100"
              />
              {corona}
            </mask>
          </defs>
          {rays}
        </>
      )
    }

    return (
      <>
        {rays}
        {corona}
      </>
    )
  }
}
