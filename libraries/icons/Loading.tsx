import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Rect } from './parts/Rect'

export class Loading extends IconBase {
  static displayName = 'LoadingIcon'
  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    return (
      <>
        <Rect
          fill={filled}
          height={80}
          stroke={filled ? 0 : 10}
          width={30}
          x={-75}
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
        </Rect>
        <Rect
          fill={filled}
          height={80}
          stroke={filled ? 0 : 10}
          width={30}
          x={-15}
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
        </Rect>
        <Rect
          fill={filled}
          height={80}
          stroke={filled ? 0 : 10}
          width={30}
          x={45}
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
        </Rect>
      </>
    )
  }
}
