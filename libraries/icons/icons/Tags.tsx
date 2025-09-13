import * as React from 'react'
import { IconBase } from '../IconBase/IconBase'
import { Tag } from './Tag'

export class Tags extends IconBase {
  static displayName = 'TagsIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    // In outline mode: rear and front are outlined, mask is filled and masks the rear
    const outlinedTag = Tag.path(false)
    const filledTag = Tag.path(true)

    return (
      <>
        <defs>
          <mask id="basis:icon:tags:mask:rear">
            <rect
              fill="white"
              height={200}
              width={200}
              x={-100}
              y={-100}
            />
            <path
              d="M-20 100 L65 15 L-30 -100 L-100 -100 L-100 100 Z"
              fill="black"
            />
          </mask>
        </defs>
        <g data-name="back" mask="url(#basis:icon:tags:mask:rear)" transform="translate(15, 0)">
          {outlinedTag}
        </g>
        <g data-name="front" transform="translate(-15, 0)">
          {filled ? filledTag : outlinedTag}
        </g>
      </>
    )
  }
}
