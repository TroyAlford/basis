import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Path } from './parts/Path'
import { LineCap } from './types/LineCap'
import { LineJoin } from './types/LineJoin'

export class LinkExternal extends IconBase {
  static displayName = 'LinkExternalIcon'
  renderContent = (): React.ReactNode => (
    <>
      <Path
        d="M10 -45 L-75 -45 L-75 65 L40 65 L40 20"
        lineCap={LineCap.Butt}
        lineJoin={LineJoin.Round}
      />
      <Path
        d="M80 -64.24V-18.64Q80 -16.24 78.24 -14.64T74.24 -12.88T70.24 -14.64L54.56 -30.32L-3.68 27.92Q-4.48 28.88 -5.76 28.88T-7.68 27.92L-17.92 17.68Q-18.88 16.88 -18.88 15.76T-17.92 13.68L40.32 -44.56L24.64 -60.24Q22.88 -62 22.88 -64.24T24.64 -68.24T28.64 -70H74.24Q76.64 -70 78.24 -68.24T80 -64.24Z"
        fill={this.props.filled}
      />
    </>
  )
}
