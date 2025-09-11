import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class ThumbsUp extends IconBase {
  static displayName = 'ThumbsUpIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props

    const thumbBase = (
      <path
        d="M-50.1389 -10.5555H-76.5278C-80.9001 -10.5555 -84.4445 -7.0112 -84.4445 -2.6389V76.5278C-84.4445 80.9001 -80.9001 84.4445 -76.5278 84.4445H-50.1389C-45.7665 84.4445 -42.2222 80.9001 -42.2222 76.5278V-2.6389C-42.2222 -7.0112 -45.7665 -10.5555 -50.1389 -10.5555Z"
        data-name="thumb-base"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        strokeWidth={filled ? undefined : '10'}
      />
    )

    const thumbShape = (
      <path
        d="M42.2222 -57.5766C42.2222 -43.5852 33.6557 -35.7372 31.2454 -26.3889H64.7999C75.8163 -26.3889 84.3927 -17.2365 84.4441 -7.2247C84.4718 -1.3076 81.955 5.0624 78.032 9.0035L77.9957 9.0398C81.2402 16.7379 80.7128 27.5243 74.9254 35.2535C77.7889 43.7953 74.9026 54.2878 69.5216 59.913C70.9393 65.7179 70.2617 70.6582 67.4935 74.6353C60.7611 84.3082 44.0747 84.4445 29.9642 84.4445L29.0258 84.4441C13.0978 84.4385 0.062 78.6392 -10.4124 73.9793C-15.6759 71.6376 -22.5582 68.7388 -27.7799 68.6428C-29.9372 68.6032 -31.6666 66.8428 -31.6666 64.6851V-5.8293C-31.6666 -6.8848 -31.2438 -7.8978 -30.493 -8.6401C-17.4259 -21.5522 -11.8071 -35.2226 -1.0968 -45.9509C3.7865 -50.8434 5.5624 -58.2337 7.2794 -65.3804C8.7463 -71.4832 11.8147 -84.4445 18.4722 -84.4445C26.3889 -84.4445 42.2222 -81.8055 42.2222 -57.5766Z"
        data-name="thumb-shape"
        fill={filled ? 'var(--basis-icon-color)' : 'transparent'}
        strokeWidth={filled ? undefined : '10'}
      />
    )

    const circle = (
      <circle
        cx={-63.3334}
        cy={63.3334}
        data-name="circle"
        fill={filled ? 'black' : 'var(--basis-icon-color)'}
        r={8.3334}
        strokeWidth={filled ? undefined : undefined}
      />
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:thumbsup:mask:circle">
              <rect
                fill="white"
                height={200}
                width={200}
                x={-100}
                y={-100}
              />
              {React.cloneElement(circle, { fill: 'black', strokeWidth: undefined })}
            </mask>
          </defs>
          {React.cloneElement(thumbBase, { mask: 'url(#basis:icon:thumbsup:mask:circle)' })}
          {React.cloneElement(thumbShape, { mask: 'url(#basis:icon:thumbsup:mask:circle)' })}
        </>
      )
    }

    return (
      <>
        {thumbBase}
        {thumbShape}
        {circle}
      </>
    )
  }
}
