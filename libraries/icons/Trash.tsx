import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Trash extends IconBase {
  static displayName = 'TrashIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const outline = (
      <path
        d="M66 -71H28L25 -77C24 -79 21 -81 18 -81H-18C-21 -81 -24 -79 -25 -77L-28 -71H-66C-69 -71 -71 -69 -71 -66V-56C-71 -53 -69 -51 -66 -51H-61V66C-61 74 -54 81 -46 81H46C54 81 61 74 61 66V-51H66C69 -51 71 -53 71 -56V-66C71 -69 69 -71 66 -71Z"
        data-name="lid-can"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        mask={filled ? 'url(#basis:icon:trash:mask:lines)' : undefined}
        strokeWidth="10"
      />
    )

    const verticalLines = (
      <path
        d="M30 -15V56ZM0 -15V56ZM-30 -15V56Z"
        data-name="vertical-lines"
        fill={filled ? 'none' : 'transparent'}
        stroke={filled ? 'black' : undefined}
        strokeLinecap="round"
        strokeWidth="10"
      />
    )

    const horizontalBar = (
      <path
        d="M-70 -50H70"
        data-name="horizontal-bar"
        fill={filled ? 'none' : 'transparent'}
        stroke={filled ? 'black' : undefined}
        strokeLinecap="round"
        strokeWidth="10"
      />
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:trash:mask:lines">
              <rect
                fill="white"
                height="200"
                width="200"
                x="-100"
                y="-100"
              />
              {verticalLines}
              {horizontalBar}
            </mask>
          </defs>
          {outline}
        </>
      )
    }

    return (
      <>
        {outline}
        {verticalLines}
        {horizontalBar}
      </>
    )
  }
}
