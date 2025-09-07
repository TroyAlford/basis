import type * as React from 'react'
import type { IPopup } from '../../mixins/Popup'
import { Popup } from '../../mixins/Popup'
import type { Mixin } from '../../types/Mixin'
import { Component } from '../Component/Component'

import './Tooltip.styles.ts'

/** Props for the Tooltip component. */
interface Props extends IPopup {
  /** The children of the tooltip. */
  children: React.ReactNode,
  /** Whether the tooltip is visible. */
  visible?: boolean | 'auto',
}

/**
 * A tooltip bubble that can be positioned relative to an anchor element or its parent.
 * Uses Floating UI for accurate positioning in all directions with automatic arrow positioning.
 * @example
 * <div className="some component">
 *   Content
 *   <Tooltip placement="top" animationDuration=".2s">
 *     Tooltip Content!
 *   </Tooltip>
 * </div>
 * @example
 * <div ref={anchorRef} className="anchor">
 *   Anchor Content
 * </div>
 * <Tooltip anchor={anchorRef} placement="bottom-end">
 *   Tooltip attached to anchor!
 * </Tooltip>
 */
export class Tooltip extends Component<Props, HTMLDivElement> {
  static displayName = 'Tooltip'
  static get mixins(): Set<Mixin> {
    return super.mixins.add(Popup)
  }

  /** Default props for tooltip. */
  static defaultProps: Props = {
    ...super.defaultProps,
    arrow: true,
    children: null,
    offset: 4,
    visible: 'auto',
  }

  get attributes() {
    return {
      ...super.attributes,
      'data-visible': this.props.visible,
      'role': 'tooltip',
    }
  }
}
