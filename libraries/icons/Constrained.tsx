import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Constrained extends IconBase {
  static displayName = 'ConstrainedIcon'
  renderContent = (): React.ReactNode => (
    <>
      <path
        d="M75 -41.6667V41.6667"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={16.666666666666668}
      />
      <path
        d="M-75 -41.6667V41.6667"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={16.666666666666668}
      />
      <path
        d="M-41.6667 0H41.6667M-41.6667 0L-20.8333 -20.8333M-41.6667 0L-20.8333 20.8333M41.6667 0L20.8333 -20.8333M41.6667 0L20.8333 20.8333"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={16.666666666666668}
      />
    </>
  )
}
