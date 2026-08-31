import type { MouseEventHandler } from 'react'
import React from 'react'
import type { JsxChild, JsxFragment } from 'typescript'
import { noop } from '@basis/utilities'
import { Component } from '../../components/Component/Component'
import { Rect } from '../parts/Rect'
import type { Shape } from '../parts/Shape'

import './IconBase.styles.ts'

export type IconProps<P = object> = Component<{
  disabled?: boolean,
  filled?: boolean,
  height?: number | string,
  onClick?: MouseEventHandler<SVGSVGElement>,
  overlay?: React.ReactElement | typeof IconBase,
  paintOrder?: string,
  strokeWidth?: number | string,
  title?: string,
  width?: number | string,
  x?: number | string,
  y?: number | string,
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
    }
  }
  static isIcon(ctor: unknown): ctor is new (...args: unknown[]) => IconBase {
    return typeof ctor === 'function' && ctor.prototype instanceof IconBase
  }

  static #nextOverlayMask = 0
  #overlayMaskId = `overlay-${IconBase.#nextOverlayMask++}`

  renderContent: () => React.ReactNode = () => null
  viewBox = '-100 -100 200 200'

  get classNames() { return super.classNames.add('icon') }
  get tag() { return 'svg' as const }

  get attributes() {
    const { disabled, height, onClick, paintOrder, strokeWidth, width, x, y } = this.props
    const clickable = Boolean(!disabled && onClick !== noop)

    return {
      ...super.attributes,
      'aria-label': this.props.title,
      'height': height,
      'onClick': clickable ? onClick : undefined,
      'paintOrder': paintOrder,
      'role': clickable ? 'button' : 'img',
      'strokeWidth': strokeWidth,
      'tabIndex': clickable ? 0 : undefined,
      'version': '1.1',
      'viewBox': this.viewBox,
      'width': width,
      'x': x,
      'xmlns': 'http://www.w3.org/2000/svg',
      'y': y,
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
    const { title } = this.props
    const overlayElement = this.#overlayElement()

    if (!overlayElement) {
      return (
        <g style={{ pointerEvents: 'none' }}>
          {title && <title>{title}</title>}
          {this.renderContent()}
        </g>
      )
    }

    const overlayMask = this.mask(this.#overlayMaskId, React.cloneElement(overlayElement, {
      className: { mask: true, overlay: true },
      filled: true,
      height: 100,
      paintOrder: 'stroke',
      strokeWidth: 40,
      width: 100,
      x: 0,
      y: 0,
    }))

    return (
      <g style={{ pointerEvents: 'none' }}>
        {title && <title>{title}</title>}
        <defs>{overlayMask}</defs>
        <g mask={overlayMask.props.url}>
          {this.renderContent()}
        </g>
        {React.cloneElement(overlayElement, {
          className: 'overlay',
          height: 100,
          paintOrder: 'stroke',
          width: 100,
          x: 0,
          y: 0,
        })}
      </g>
    )
  }

  #overlayElement(): React.ReactElement<IconProps> | null {
    const { filled, overlay } = this.props
    if (React.isValidElement(overlay)) return overlay as React.ReactElement<IconProps>
    if (!overlay) return null

    return React.createElement(overlay as unknown as React.ComponentType<IconProps>, { filled })
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
