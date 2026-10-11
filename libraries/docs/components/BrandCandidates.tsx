import * as React from 'react'
import type { IconProps } from '../../react/icons/IconBase/IconBase'
import { IconBase } from '../../react/icons/IconBase/IconBase'
import { Path } from '../../react/icons/parts/Path'

/*
 * Brand-mark candidates for Basis, using the geometry of established
 * open-source icon sets rather than invented shapes. Each carries its source
 * and license. The chosen mark gets promoted into `basis/react/icons`; these
 * stay here so the public icon set does not ship every option.
 */

/** Outline isometric cube — Lucide `box` (ISC). */
export class BasisCube extends IconBase {
  static displayName = 'BasisCube'
  viewBox = '0 0 24 24'
  renderContent = (): React.ReactNode => (
    <>
      <Path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" stroke={2} />
      <Path d="m3.3 7 8.7 5 8.7-5" stroke={2} />
      <Path d="M12 22V12" stroke={2} />
    </>
  )
}

/** Solid isometric cube — Phosphor `cube` (MIT). */
// eslint-disable-next-line @stylistic/max-len -- verbatim upstream Phosphor path data
const BASIS_CUBE_SOLID_D = 'M223.68,66.15,135.68,18h0a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32h0l80.34,44L128,120,47.66,76ZM40,90l80,43.78v85.79L40,175.82Zm96,129.57V133.82L216,90v85.78Z'

export class BasisCubeSolid extends IconBase {
  static displayName = 'BasisCubeSolid'
  viewBox = '0 0 256 256'
  renderContent = (): React.ReactNode => (
    <Path
      fill
      d={BASIS_CUBE_SOLID_D}
      stroke={0}
    />
  )
}

/** Wireframe cube with a shared origin vertex — Tabler `cube` (MIT). */
export class BasisCubeWire extends IconBase {
  static displayName = 'BasisCubeWire'
  viewBox = '0 0 24 24'
  renderContent = (): React.ReactNode => (
    <>
      <Path d="M21 16.008v-8.018a1.98 1.98 0 0 0 -1 -1.717l-7 -4.008a2.016 2.016 0 0 0 -2 0l-7 4.008c-.619 .355 -1 1.01 -1 1.718v8.018c0 .709 .381 1.363 1 1.717l7 4.008a2.016 2.016 0 0 0 2 0l7 -4.008c.619 -.355 1 -1.01 1 -1.718" stroke={2} />
      <Path d="M12 22v-10" stroke={2} />
      <Path d="M12 12l8.73 -5.04" stroke={2} />
      <Path d="M3.27 6.96l8.73 5.04" stroke={2} />
    </>
  )
}

/** Origin with basis vectors — Lucide `axis-3d` (ISC). */
export class BasisAxis extends IconBase {
  static displayName = 'BasisAxis'
  viewBox = '0 0 24 24'
  renderContent = (): React.ReactNode => (
    <>
      <Path d="M13.5 10.5 15 9" stroke={2} />
      <Path d="M4 4v15a1 1 0 0 0 1 1h15" stroke={2} />
      <Path d="M4.293 19.707 6 18" stroke={2} />
      <Path d="m9 15 1.5-1.5" stroke={2} />
    </>
  )
}

/** A single graduated axis — Tabler `axis-x` (MIT). */
export class BasisAxisX extends IconBase {
  static displayName = 'BasisAxisX'
  viewBox = '0 0 24 24'
  renderContent = (): React.ReactNode => (
    <>
      <Path d="M4 13v.01" stroke={2} />
      <Path d="M4 9v.01" stroke={2} />
      <Path d="M4 5v.01" stroke={2} />
      <Path d="M17 20l3 -3l-3 -3" stroke={2} />
      <Path d="M4 17h16" stroke={2} />
    </>
  )
}

/** Anvil — Lucide `anvil` (ISC). */
export class BasisAnvil extends IconBase {
  static displayName = 'BasisAnvil'
  viewBox = '0 0 24 24'
  renderContent = (): React.ReactNode => (
    <>
      <Path d="M7 10H6a4 4 0 0 1-4-4 1 1 0 0 1 1-1h4" stroke={2} />
      <Path d="M7 5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1 7 7 0 0 1-7 7H8a1 1 0 0 1-1-1z" stroke={2} />
      <Path d="M9 12v5" stroke={2} />
      <Path d="M15 12v5" stroke={2} />
      <Path d="M5 20a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3 1 1 0 0 1-1 1H6a1 1 0 0 1-1-1" stroke={2} />
    </>
  )
}

/** Stacked layers — Lucide `layers` (ISC). */
export class BasisLayers extends IconBase {
  static displayName = 'BasisLayers'
  viewBox = '0 0 24 24'
  renderContent = (): React.ReactNode => (
    <>
      <Path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" stroke={2} />
      <Path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" stroke={2} />
      <Path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" stroke={2} />
    </>
  )
}

/** A brand-mark candidate shown on the docs icons page. */
export interface BrandCandidate {
  /** The icon component. */
  Icon: React.ComponentType<IconProps>,
  /** The component name shown under the mark. */
  name: string,
  /** The upstream icon and its license. */
  source: string,
}

/** The candidate marks, straight from established open-source sets. */
export const BRAND_CANDIDATES: BrandCandidate[] = [
  { Icon: BasisCube, name: 'BasisCube', source: 'Lucide box (ISC)' },
  { Icon: BasisCubeSolid, name: 'BasisCubeSolid', source: 'Phosphor cube (MIT)' },
  { Icon: BasisCubeWire, name: 'BasisCubeWire', source: 'Tabler cube (MIT)' },
  { Icon: BasisAxis, name: 'BasisAxis', source: 'Lucide axis-3d (ISC)' },
  { Icon: BasisAxisX, name: 'BasisAxisX', source: 'Tabler axis-x (MIT)' },
  { Icon: BasisAnvil, name: 'BasisAnvil', source: 'Lucide anvil (ISC)' },
  { Icon: BasisLayers, name: 'BasisLayers', source: 'Lucide layers (ISC)' },
]
