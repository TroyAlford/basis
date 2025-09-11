import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Loading extends IconBase {
  static displayName = 'LoadingIcon'
  renderContent = (): React.ReactNode => (
    <>
      <rect
        height={66.66666666666667}
        opacity={0.2}
        width={26.666666666666668}
        x={-66.66666666666667}
        y={-33.33333333333333}
      >
        <animate
          attributeName="opacity"
          attributeType="XML"
          begin="0s"
          dur="0.6s"
          repeatCount="indefinite"
          values="0.2; 1; .2"
        />
        <animate
          attributeName="height"
          attributeType="XML"
          begin="0s"
          dur="0.6s"
          repeatCount="indefinite"
          values="66.66666666666667; 133.33333333333334; 66.66666666666667"
        />
        <animate
          attributeName="y"
          attributeType="XML"
          begin="0s"
          dur="0.6s"
          repeatCount="indefinite"
          values="-33.33333333333333; -66.66666666666666; -33.33333333333333"
        />
      </rect>
      <rect
        height={66.66666666666667}
        opacity={0.2}
        width={26.666666666666668}
        x={-13.333333333333336}
        y={-33.33333333333333}
      >
        <animate
          attributeName="opacity"
          attributeType="XML"
          begin="0.15s"
          dur="0.6s"
          repeatCount="indefinite"
          values="0.2; 1; .2"
        />
        <animate
          attributeName="height"
          attributeType="XML"
          begin="0.15s"
          dur="0.6s"
          repeatCount="indefinite"
          values="66.66666666666667; 133.33333333333334; 66.66666666666667"
        />
        <animate
          attributeName="y"
          attributeType="XML"
          begin="0.15s"
          dur="0.6s"
          repeatCount="indefinite"
          values="-33.33333333333333; -66.66666666666666; -33.33333333333333"
        />
      </rect>
      <rect
        height={66.66666666666667}
        opacity={0.2}
        width={26.666666666666668}
        x={40}
        y={-33.33333333333333}
      >
        <animate
          attributeName="opacity"
          attributeType="XML"
          begin="0.3s"
          dur="0.6s"
          repeatCount="indefinite"
          values="0.2; 1; .2"
        />
        <animate
          attributeName="height"
          attributeType="XML"
          begin="0.3s"
          dur="0.6s"
          repeatCount="indefinite"
          values="66.66666666666667; 133.33333333333334; 66.66666666666667"
        />
        <animate
          attributeName="y"
          attributeType="XML"
          begin="0.3s"
          dur="0.6s"
          repeatCount="indefinite"
          values="-33.33333333333333; -66.66666666666666; -33.33333333333333"
        />
      </rect>
    </>
  )
}
