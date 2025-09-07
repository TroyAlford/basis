import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Constrained extends IconBase {
  static displayName = 'ConstrainedIcon'
  renderContent = (): React.ReactNode => (
    <>
      <path
        d="M21 7V17"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M3 7V17"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M7 12H17M7 12L9.5 9.5M7 12L9.5 14.5M17 12L14.5 9.5M17 12L14.5 14.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </>
  )
  viewBox = '0 0 24 24'
}
