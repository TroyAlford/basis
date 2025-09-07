import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Save extends IconBase {
  static displayName = 'SaveIcon'
  renderContent = (): React.ReactNode => (
    <path d="M21.056 3.2l4.544 4.992v17.408q0 1.28-0.928 2.24t-2.272 0.96h-19.2q-1.28 0-2.24-0.96t-0.96-2.24v-19.2q0-1.344 0.96-2.272t2.24-0.928h17.856zM19.2 12.8v-8h-12.8v8q0 0.64 0.48 1.12t1.12 0.48h9.6q0.64 0 1.12-0.48t0.48-1.12zM17.6 6.4v6.4h-3.2v-6.4h3.2z" />
  )
  viewBox = '-3 -1 32 34'
}
