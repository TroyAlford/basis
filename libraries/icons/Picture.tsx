import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Picture extends IconBase {
  static displayName = 'PictureIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const frame = (
      <path
        d="M85.6829 -54.24V54.24Q85.6829 60.16 81.5229 64.32T71.4429 68.64H-71.4371Q-77.1971 68.64 -81.5171 64.32T-85.6771 54.24V-54.24Q-85.6771 -60.16 -81.5171 -64.32T-71.4371 -68.64H71.4429Q77.3629 -68.64 81.5229 -64.32T85.6829 -54.24Z"
        data-name="frame"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        mask={filled ? 'url(#basis:icon:picture:mask:frame)' : undefined}
        strokeWidth={10}
      />
    )

    const moon = (
      <circle
        cx={-45.67718571428574}
        cy={-28.64}
        data-name="moon"
        fill={filled ? 'black' : 'transparent'}
        r={17.12}
        strokeWidth={filled ? undefined : '10'}
      />
    )

    const mountain = (
      <path
        d="M62.9629 5.76V45.76H-62.7971V28.64L-34.3171 0L-19.9171 14.24L25.6829 -31.36Z"
        data-name="mountain"
        fill={filled ? 'black' : 'transparent'}
        strokeWidth={filled ? undefined : '10'}
      />
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:picture:mask:frame">
              <rect
                fill="white"
                height={200}
                width={200}
                x={-100}
                y={-100}
              />
              {moon}
              {mountain}
            </mask>
          </defs>
          {frame}
        </>
      )
    }

    return (
      <>
        {frame}
        {moon}
        {mountain}
      </>
    )
  }
}
