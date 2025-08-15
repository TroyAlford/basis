import * as React from 'react'
import { isNil } from '@basis/utilities'
import { Direction } from '../../types/Direction'
import { Component } from '../Component/Component'

import './Tooltip.styles.ts'

/** Props for the Tooltip component. */
interface Props {
  /** The animation duration for the tooltip. */
  animationDuration?: number | string,
  /** The children of the tooltip. */
  children: React.ReactNode,
  /** The direction where the tooltip should appear. */
  direction?: Direction,
  /** The offset distance from the parent element. If a number is provided, 'px' will be appended. */
  offset?: number | string,
  /** Whether the tooltip is visible. */
  visible?: boolean | 'auto',
}

/**
 * A tooltip bubble that anchors to its nearest parent element automatically.
 * Place it as a direct child of the element you want to describe.
 * @example
 * <div className="some component">
 *   Content
 *   <Tooltip direction={Tooltip.Direction.NE} offset={8} animationDuration=".2s">
 *     Tooltip Content!
 *   </Tooltip>
 * </div>
 */
export class Tooltip extends Component<Props, HTMLDivElement> {
  static displayName = 'Tooltip'

  /** Direction enum for tooltip positioning. */
  static Direction = Direction

  /** Default props for tooltip. */
  static defaultProps: Props = {
    animationDuration: '.125s',
    children: null,
    direction: Direction.N,
    offset: '.25em',
    visible: 'auto',
  }

  get attributes() {
    return {
      ...super.attributes,
      'data-direction': this.props.direction,
      'data-visible': this.props.visible,
      'role': 'tooltip',
      'style': {
        '--tooltip-animation-duration': this.animationDuration,
        '--tooltip-offset': this.offset,
      },
    }
  }

  get classNames(): Set<string> {
    return super.classNames.add('tooltip')
  }

  /**
   * Gets the animation duration with fallback to default.
   * @returns The animation duration string
   */
  get animationDuration(): string {
    const { animationDuration } = this.props
    if (isNil(animationDuration) || animationDuration === '') {
      return Tooltip.defaultProps.animationDuration as string
    }
    if (typeof animationDuration === 'number') return `${animationDuration}s`
    return animationDuration
  }

  /**
   * Converts the offset prop to a CSS string.
   * If it's a number, appends 'px'. If it's a string, returns as-is.
   * Empty strings fall back to default.
   * @returns The CSS string representation of the offset
   */
  get offset(): string {
    const { offset } = this.props
    if (isNil(offset) || offset === '') return Tooltip.defaultProps.offset as string
    if (typeof offset === 'number') return `${offset}px`
    return offset
  }

  content(children?: React.ReactNode): React.ReactNode {
    return (
      <>
        <div className="bubble">
          {children}
        </div>
        <div className="arrow" />
      </>
    )
  }
}
