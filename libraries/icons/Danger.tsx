import * as React from 'react'
import { IconBase } from './IconBase/IconBase'
import { Circle } from './parts/Circle'
import { Path } from './parts/Path'
import { Rect } from './parts/Rect'

export class Danger extends IconBase {
  static displayName = 'DangerIcon'

  renderContent = (): React.ReactNode => {
    const { filled } = this.props
    const faceColor = filled ? 'black' : 'var(--basis-icon-color)'

    const features = (
      <g data-name="features">
        <Circle
          fill
          color={faceColor}
          data-name="left-eye"
          position={[-15.2, 1.6]}
          radius={10}
          stroke={0}
        />
        <Circle
          fill
          color={faceColor}
          data-name="right-eye"
          position={[15.2, 1.6]}
          radius={10}
          stroke={0}
        />
        <Path
          fill
          color={faceColor}
          d="M4.96 20.64C4.96 20.64 0.96 18.72 -4.64 20.64C-4.64 20.64 -4.64 13.6 0.32 13.6S4.96 20.64 4.96 20.64Z"
          data-name="nose"
          stroke={0}
        />
      </g>
    )

    const bones = (
      <g data-name="bones" fill={filled ? 'var(--basis-icon-color)' : 'transparent'} strokeWidth={filled ? 5 : 10}>
        <Path
          d="M-56.56 -41.52C-58.96 -39.28 -62.16 -37.84 -65.52 -37.84C-72.56 -37.84 -78.32 -43.6 -78.32 -50.64C-78.32 -57.52 -72.56 -63.28 -65.52 -63.28C-64.72 -63.28 -63.92 -63.28 -62.96 -62.96C-63.12 -63.92 -63.28 -64.72 -63.28 -65.68C-63.28 -72.56 -57.52 -78.32 -50.48 -78.32C-43.6 -78.32 -37.84 -72.56 -37.84 -65.68C-37.84 -62.16 -39.28 -58.96 -41.52 -56.56L-33.36 -48.4C-39.6 -44.72 -44.72 -39.6 -48.4 -33.36L-56.56 -41.52"
          data-name="top-left"
          fill={filled}
          stroke={filled ? 5 : 10}
        />
        <Path
          d="M41.68 -56.56C39.44 -58.96 38 -62.16 38 -65.68C38 -72.56 43.76 -78.32 50.8 -78.32S63.44 -72.56 63.44 -65.68C63.44 -64.72 63.28 -63.92 63.12 -62.96C64.08 -63.28 64.88 -63.28 65.84 -63.28C72.72 -63.28 78.48 -57.52 78.48 -50.64S72.72 -37.84 65.84 -37.84C62.32 -37.84 59.12 -39.28 56.72 -41.52L48.72 -33.52C44.88 -39.6 39.76 -44.72 33.68 -48.56L41.68 -56.56"
          data-name="top-right"
          fill={filled}
          stroke={filled ? 5 : 10}
        />
        <Path
          d="M-37.84 65.36C-37.84 72.4 -43.6 78.16 -50.48 78.16C-57.52 78.16 -63.28 72.4 -63.28 65.36C-63.28 64.72 -63.28 63.92 -63.12 63.28C-63.76 63.44 -64.56 63.44 -65.2 63.44C-72.24 63.44 -78 57.68 -78 50.64C-78 43.76 -72.24 38 -65.2 38C-61.84 38 -58.8 39.28 -56.4 41.52L-48.4 33.52C-46.16 37.04 -43.44 40.4 -40.4 43.28C-40.4 43.28 -40.4 43.44 -40.4 43.6C-40.4 46.96 -39.28 50.16 -37.36 52.56L-41.36 56.56C-39.12 58.96 -37.84 62 -37.84 65.36"
          data-name="bottom-left"
          fill={filled}
          stroke={filled ? 5 : 10}
        />
        <Path
          d="M65.52 63.44C64.72 63.44 63.92 63.44 63.28 63.28C63.44 63.92 63.44 64.72 63.44 65.36C63.44 72.4 57.68 78.16 50.8 78.16C43.76 78.16 38 72.4 38 65.36C38 62 39.44 58.96 41.52 56.56L37.52 52.56C39.28 50 40.4 46.96 40.4 43.6C40.4 43.6 40.4 43.44 40.4 43.44C43.6 40.56 46.32 37.2 48.56 33.52L56.56 41.52C58.96 39.28 62 38 65.52 38C72.4 38 78.16 43.76 78.16 50.64C78.16 57.68 72.4 63.44 65.52 63.44Z"
          data-name="bottom-right"
          fill={filled}
          stroke={filled ? 5 : 10}
        />
      </g>
    )
    const skull = (
      <Path
        d="M26.1409 29.7341C26.3238 30.459 26.5066 31.3652 26.5066 32.0901C26.5066 39.3394 20.4715 45.32 13.1562 45.32C10.7787 45.32 8.5841 44.5951 6.5724 43.5077C4.7435 44.5951 2.366 45.32 -0.0114 45.32S-4.5835 44.5951 -6.5952 43.5077C-8.607 44.5951 -10.8016 45.32 -13.179 45.32C-20.4944 45.32 -26.5295 39.3394 -26.5295 32.0901C-26.5295 31.1839 -26.3466 30.2778 -26.1638 29.5529C-34.5764 22.3036 -39.88 11.611 -39.88 -0.3503C-39.88 -22.2793 -21.9574 -40.04 0.1714 -40.04C22.1174 -40.04 40.04 -22.2793 40.04 -0.3503C40.04 11.611 34.7364 22.4848 26.1409 29.7341"
        data-name="skull"
        fill={filled}
        stroke={filled ? 5 : 10}
      />
    )

    if (filled) {
      return (
        <>
          <defs>
            <mask id="basis:icon:danger:mask:features">
              <Rect
                fill
                color="white"
                height={200}
                width={200}
                x={-100}
                y={-100}
              />
              {features}
            </mask>
          </defs>
          {React.cloneElement(bones, { mask: 'url(#basis:icon:danger:mask:features)' })}
          {React.cloneElement(skull, { mask: 'url(#basis:icon:danger:mask:features)' })}
        </>
      )
    }

    return (
      <>
        {features}
        {bones}
        {skull}
      </>
    )
  }
}
