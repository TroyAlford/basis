import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Tag extends IconBase {
  static displayName = 'TagIcon'
  renderContent = (): React.ReactNode => (
    <path d="M0 11.744v-9.184q0.064-0.992 0.768-1.728t1.664-0.704h9.184q2.816 0.192 4.256 1.76l13.632 15.104q0.608 0.896 0.608 1.856t-0.608 1.664l-10.688 10.688q-0.8 0.672-1.824 0.672t-1.664-0.672l-13.568-15.2q-1.76-2.048-1.76-4.256zM4 6.496q0.064 0.992 0.736 1.664t1.632 0.64q1.024 0 1.664-0.704t0.672-1.6q0-1.056-0.736-1.728t-1.6-0.64q-1.056 0.064-1.696 0.736t-0.672 1.632z" />
  )
  viewBox = '0 -5 30 42'
}
