import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Warning extends IconBase {
  static displayName = 'WarningIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const triangle = (
      <path
        d="M9.1636 -67.3455L71.4182 46.9818Q74.3273 52.0727 71.2727 57.1636Q69.9636 59.6364 67.4909 60.9455T62.4 62.4H-62.4Q-65.0182 62.4 -67.4909 60.9455T-71.2727 57.1636Q-74.3273 52.0727 -71.4182 46.9818L-9.0182 -67.3455Q-7.7091 -69.8182 -5.2364 -71.2727T0 -72.7273T5.2364 -71.2727T9.1636 -67.3455Z"
        data-name="triangle"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        strokeWidth={10}
      />
    )

    const exclamation = (
      <path
        d="M10.3273 38.8364V23.4182Q10.3273 22.2545 9.6 21.5273T7.8545 20.8H-7.8545Q-8.8727 20.8 -9.6 21.5273T-10.3273 23.4182V38.8364Q-10.3273 40 -9.6 40.7273T-7.8545 41.6H7.8545Q8.8727 41.6 9.6 40.7273T10.3273 38.8364ZM10.1818 8.5818L11.6364 -28.8Q11.6364 -29.6727 10.9091 -30.2545Q9.8909 -31.1273 8.8727 -31.1273H-8.8727Q-9.7455 -31.1273 -10.9091 -30.2545Q-11.6364 -29.6727 -11.6364 -28.5091L-10.3273 8.5818Q-10.3273 9.3091 -9.4545 9.8909T-7.5636 10.3273H7.4182Q8.5818 10.3273 9.4545 9.8909T10.1818 8.5818Z"
        data-name="exclamation"
        fill={filled ? 'black' : 'var(--basis-icon-color)'}
        strokeWidth={filled ? undefined : undefined}
      />
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:warning:mask:exclamation">
              <rect
                fill="white"
                height={200}
                width={200}
                x={-100}
                y={-100}
              />
              {React.cloneElement(exclamation, { fill: 'black', strokeWidth: undefined })}
            </mask>
          </defs>
          {React.cloneElement(triangle, { mask: 'url(#basis:icon:warning:mask:exclamation)' })}
        </>
      )
    }

    return (
      <>
        {triangle}
        {exclamation}
      </>
    )
  }
}
