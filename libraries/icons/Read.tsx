import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Read extends IconBase {
  static displayName = 'ReadIcon'
  renderContent = (): React.ReactNode => (
    <path d="M-0.76 -44.64Q0.04 -45.44 1.64 -46.56T9.16 -50.72T22.44 -56.32T42.76 -60.64T70.76 -62.56V44.64Q55.56 44.64 42.6 46.56T22.12 50.88T9 56.32T1.48 60.96L-0.76 62.56Q-1.4 61.92 -2.84 60.64T-10.2 56.48T-23.48 50.88T-43.8 46.56T-72.12 44.64V-62.56Q-57.08 -62.56 -44.28 -60.64T-23.8 -56.32T-10.52 -51.04T-2.84 -46.4ZM-54.2 -44.64V27.36Q-26.68 29.6 -9.56 38.72V-33.12Q-27.16 -42.4 -54.2 -44.64ZM52.84 27.36V-44.64Q25.96 -42.4 8.36 -33.12V38.72Q25.64 29.6 52.84 27.36Z" />
  )
}
