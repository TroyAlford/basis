import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Loading extends IconBase {
  static displayName = 'LoadingIcon'
  renderContent = (): React.ReactNode => {
    return (
      <>
        <rect
          height="10"
          opacity="0.2"
          width="4"
          x="0"
          y="10"
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
            values="10; 20; 10"
          />
          <animate
            attributeName="y"
            attributeType="XML"
            begin="0s"
            dur="0.6s"
            repeatCount="indefinite"
            values="10; 5; 10"
          />
        </rect>
        <rect
          height="10"
          opacity="0.2"
          width="4"
          x="8"
          y="10"
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
            values="10; 20; 10"
          />
          <animate
            attributeName="y"
            attributeType="XML"
            begin="0.15s"
            dur="0.6s"
            repeatCount="indefinite"
            values="10; 5; 10"
          />
        </rect>
        <rect
          height="10"
          opacity="0.2"
          width="4"
          x="16"
          y="10"
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
            values="10; 20; 10"
          />
          <animate
            attributeName="y"
            attributeType="XML"
            begin="0.3s"
            dur="0.6s"
            repeatCount="indefinite"
            values="10; 5; 10"
          />
        </rect>
      </>
    )
  }
  viewBox = '0 0 20 30'
}
