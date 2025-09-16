import type { MouseEventHandler } from 'react'
import React from 'react'
import type { JsxChild, JsxFragment } from 'typescript'
import { Component } from '@basis/react'
import { noop } from '@basis/utilities'
import { Rect } from '../parts/Rect.tsx'
import type { Shape } from '../parts/Shape.tsx'

import './IconBase.styles.ts'

export type IconProps<P = object> = Component<{
  disabled?: boolean,
  filled?: boolean,
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
      disabled: false,
      filled: false,
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

  renderContent: () => React.ReactNode = () => null
  viewBox = '-100 -100 200 200'

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

  // Smart defaults for SVG elements
  get defaultFill() {
    return this.props.filled ? 'var(--basis-icon-color)' : 'transparent'
  }

  get defaultStroke() {
    return 'var(--basis-icon-color)'
  }

  get defaultStrokeWidth() {
    return this.props.filled ? '10' : '10'
  }

  // Helper method to get smart defaults for SVG elements
  getSvgProps(overrides: Partial<{
    fill: string | boolean,
    stroke: string | boolean,
    strokeWidth: string | number | boolean,
  }> = {}) {
    const { fill, stroke, strokeWidth } = overrides

    return {
      fill: fill === false ? 'transparent'
        : fill === true ? 'var(--basis-icon-color)'
          : fill || this.defaultFill,
      stroke: stroke === false ? 'transparent'
        : stroke === true ? 'var(--basis-icon-color)'
          : stroke || this.defaultStroke,
      strokeWidth: strokeWidth === false ? '0'
        : strokeWidth === true ? '10'
          : strokeWidth || this.defaultStrokeWidth,
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

  /**
   * Process mask children by setting their color to black
   * @param child - The child to process
   * @returns The processed child
   */
  #maskChildren = (child: React.ReactNode | JsxChild): React.ReactNode => {
    if (React.isValidElement<Shape>(child)) {
      // @ts-expect-error - color is valid for Shape children
      return React.cloneElement(child, { color: 'black' })
    }

    return child as React.ReactNode
  }

  /**
   * Create a mask for the given children
   * @param id - A unique identifier for the mask
   * @param children - The children to mask out
   * @returns A mask element with a white background and children converted to black
   */
  mask(id: string, children: React.ReactNode) {
    const displayName = 'displayName' in this.constructor
      ? this.constructor.displayName
      : this.constructor.name

    const maskId = `basis:icon:${displayName}:mask:${id}`

    const processed = React.isValidElement<JsxFragment>(children) && children.type === React.Fragment
      ? React.Children.map(children.props.children, this.#maskChildren)
      : this.#maskChildren(children)

    return (
      <mask
        id={maskId}
        // @ts-expect-error - not valid SVG, but useful for our DX
        url={`url(#${maskId})`}
      >
        <Rect
          fill
          color="white"
          height={200}
          width={200}
          x={-100}
          y={-100}
        />
        {processed}
      </mask>
    )
  }
}
