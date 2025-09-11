import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Edit extends IconBase {
  static displayName = 'EditIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const pencil = (
      <path
        d="M0 30 L75 -50 L55 -70 L-20 10 L-20 30 Z"
        data-name="pencil"
      />
    )

    const lines = (
      <g data-name="lines" strokeWidth={5}>
        <path d="M-15 5 L5 25" data-name="tip-line" />
        <path d="M60 -35 L40 -55" data-name="eraser-line" />
      </g>
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:edit:mask:pencil">
              <rect
                fill="white"
                height={200}
                width={200}
                x={-100}
                y={-100}
              />
              {React.cloneElement(pencil, { fill: 'black', stroke: 'black', strokeWidth: 30 })}
            </mask>
            <mask id="basis:icon:edit:mask:lines">
              <rect
                fill="white"
                height={200}
                width={200}
                x={-100}
                y={-100}
              />
              {React.cloneElement(lines, { fill: 'black', stroke: 'black' })}
            </mask>
          </defs>
          <rect
            data-name="square"
            fill="var(--basis-icon-color)"
            height={105}
            mask="url(#basis:icon:edit:mask:pencil)"
            strokeWidth={10}
            width={105}
            x={-60}
            y={-35}
          />
          {React.cloneElement(pencil, { fill: 'var(--basis-icon-color)', mask: 'url(#basis:icon:edit:mask:lines)', strokeWidth: 10 })}
        </>
      )
    }

    return (
      <>
        <defs>
          <mask id="basis:icon:edit:mask:pencil">
            <rect
              fill="white"
              height={200}
              width={200}
              x={-100}
              y={-100}
            />
            {React.cloneElement(pencil, { fill: 'black', stroke: 'black', strokeWidth: 30 })}
          </mask>
        </defs>
        <rect
          data-name="square"
          fill="transparent"
          height={105}
          mask="url(#basis:icon:edit:mask:pencil)"
          strokeWidth={10}
          width={105}
          x={-60}
          y={-35}
        />
        {React.cloneElement(pencil, { fill: 'transparent', strokeWidth: 10 })}
        {lines}
      </>
    )
  }
}
