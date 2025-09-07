import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class HeartFilled extends IconBase {
  static displayName = 'HeartFilledIcon'
  renderContent = (): React.ReactNode => (
    <path d="M16 29.728q-0.448 0-0.8-0.32l-11.136-10.752q-0.16-0.16-0.48-0.48t-0.992-1.184-1.216-1.728-0.96-2.144-0.416-2.464q0-3.936 2.272-6.144t6.272-2.24q1.088 0 2.24 0.384t2.144 1.056 1.728 1.216 1.344 1.216q0.64-0.64 1.344-1.216t1.728-1.216 2.144-1.056 2.24-0.384q4 0 6.272 2.24t2.272 6.144q0 3.936-4.096 8.032l-11.104 10.72q-0.32 0.32-0.8 0.32z" />
  )
  viewBox = '0 -4 32 40'
}
