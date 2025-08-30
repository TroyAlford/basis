import * as React from 'react'
import { isNil } from '@basis/utilities'
import type { IDirectional } from '../../mixins/Directional'
import { Directional } from '../../mixins/Directional'
import { Direction } from '../../types/Direction'
import type { Mixin } from '../../types/Mixin'
import { Component } from '../Component/Component'

import './Tooltip.styles.ts'

/** Props for the Tooltip component. */
interface Props extends IDirectional {
  /** The animation duration for the tooltip. */
  animationDuration?: number | string,
  /** The children of the tooltip. */
  children: React.ReactNode,
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
  static Direction = Direction

  static displayName = 'Tooltip'
  static get mixins(): Set<Mixin> {
    return super.mixins.add(Directional)
  }

  /** Default props for tooltip. */
  static defaultProps: Props = {
    ...super.defaultProps,
    animationDuration: '.125s',
    children: null,
    visible: 'auto',
  }

  get attributes() {
    return {
      ...super.attributes,
      'data-visible': this.props.visible,
      'role': 'tooltip',
      'style': {
        '--tooltip-animation-duration': this.animationDuration,
      },
    }
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
