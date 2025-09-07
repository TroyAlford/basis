import type { MouseEventHandler } from 'react'
import React from 'react'
import { Component } from '@basis/react'
import { noop } from '@basis/utilities'

import './IconBase.styles.ts'

export type IconProps<P = object> = Component<{
  disabled?: boolean,
  onClick?: MouseEventHandler<SVGSVGElement>,
  overlay?: typeof IconBase,
  title?: string,
}>['props'] & P

export abstract class IconBase<
  Props extends IconProps = IconProps,
> extends Component<Props, SVGSVGElement> {
  static get defaultProps() {
    return {
      ...super.defaultProps,
      color: 'var(--basis-icon-color, currentColor)',
      disabled: false,
      onClick: noop,
      overlay: null,
      overlayColor: 'var(--basis-icon-overlay-color, currentColor)',
      overlayStroke: 'var(--basis-icon-overlay-stroke)',
      stroke: 'var(--basis-icon-stroke, transparent)',
    }
  }
  static isIcon(ctor: unknown): ctor is new (...args: unknown[]) => IconBase {
    return typeof ctor === 'function' && ctor.prototype instanceof IconBase
  }

  abstract renderContent: () => React.ReactNode
  abstract readonly viewBox: string

  get classNames() { return super.classNames.add('icon') }
  get tag() { return 'svg' as const }

  get attributes() {
    const { disabled, onClick } = this.props
    const clickable = Boolean(!disabled && onClick !== noop)

    return {
      ...super.attributes,
      'aria-label': this.props.title,
      'onClick': clickable ? onClick : undefined,
      'role': clickable ? 'button' : 'img',
      'tabIndex': clickable ? 0 : undefined,
      'version': '1.1',
      'viewBox': this.viewBox,
      'xmlns': 'http://www.w3.org/2000/svg',
    }
  }

  content(): React.ReactNode {
    const { overlay, title } = this.props
    const Overlay = overlay as typeof IconBase

    return (
      <g style={{ pointerEvents: 'none' }}>
        {title && <title>{title}</title>}
        {this.renderContent()}
        {Overlay && ( // @ts-expect-error - TS doesn't like the SVGProps definitions
          <Overlay
            className="overlay"
            height={50}
            paintOrder="stroke"
            strokeWidth={50}
            width={50}
            x={50}
            y={50}
          />
        )}
      </g>
    )
  }
}
