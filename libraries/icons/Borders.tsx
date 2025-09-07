import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Borders extends IconBase {
  static displayName = 'BordersIcon'
  renderContent = (): React.ReactNode => (
    <>
      <circle cx={50} cy={50} r={35} />
      <circle cx={150} cy={50} r={35} />
      <circle cx={250} cy={50} r={35} />
      <circle cx={350} cy={50} r={35} />
      <circle cx={450} cy={50} r={35} />
      <circle cx={450} cy={150} r={35} />
      <circle cx={450} cy={250} r={35} />
      <circle cx={450} cy={350} r={35} />
      <circle cx={50} cy={150} r={35} />
      <circle cx={50} cy={250} r={35} />
      <circle cx={50} cy={350} r={35} />
      <circle cx={50} cy={450} r={35} />
      <circle cx={150} cy={450} r={35} />
      <circle cx={250} cy={450} r={35} />
      <circle cx={350} cy={450} r={35} />
      <circle cx={450} cy={450} r={35} />
    </>
  )
  viewBox = '-40 -40 580 580'
}
