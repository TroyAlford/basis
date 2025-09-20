import type * as React from 'react'
import { isRefObject, match } from '@basis/utilities'
import { AnchorPoint } from '../types/AnchorPoint'
import type { Mixin } from '../types/Mixin'
import { cleanupRepositioning, repositionPopup } from '../utilities/repositionPopup'

import './Popup.styles.ts'

/** Interface for popup elements. */
export interface IPopup {
  /** The anchor point where the popup should be positioned relative to the reference element. */
  anchorPoint?: AnchorPoint,
  /** Optional ref to the element the popup should attach to. If omitted, targets parent element. */
  anchorTo?: HTMLElement | React.RefObject<HTMLElement>,
  /** Whether to show an arrow pointing to the reference element. */
  arrow?: boolean,
  /** The offset distance between the popup and reference element. */
  offset?: number,
}

const reposition = (
  component: { props: IPopup, rootNode: HTMLElement | SVGElement | null },
) => {
  const { anchorPoint, anchorTo, offset } = component.props
  const popup = component.rootNode as HTMLElement

  if (!popup) return

  const anchor: HTMLElement | null = match(anchorTo)
    .when(isRefObject).then(ref => ref.current)
    .when(el => el instanceof HTMLElement).then(el => el as HTMLElement)
    .else(popup.parentElement)

  if (!anchor) return

  repositionPopup(popup, anchor, {
    anchorPoint: anchorPoint ?? AnchorPoint.Top,
    offset: offset ?? 0,
  })
}

/** Mixin for popup elements that can be positioned relative to an anchor. */
export const Popup: Mixin<IPopup> = {
  attributes(props: IPopup) {
    return {
      'data-popup': true,
      'data-popup-anchor-point': props.anchorPoint,
      'data-popup-arrow': !!props.arrow,
    }
  },

  componentDidMount<E extends HTMLElement | SVGElement>(
    component: { props: IPopup, rootNode: E | null },
  ): void {
    component.rootNode.setAttribute('popover', 'manual');
    (component.rootNode as HTMLElement).showPopover?.()
    reposition(component)
  },

  componentDidUpdate<E extends HTMLElement | SVGElement>(
    component: { props: IPopup, rootNode: E | null },
    prevProps: IPopup,
  ): void {
    if (
      prevProps.anchorTo !== component.props.anchorTo
      || prevProps.anchorPoint !== component.props.anchorPoint
      || prevProps.arrow !== component.props.arrow
    ) {
      reposition(component)
    }
  },

  componentWillUnmount<E extends HTMLElement | SVGElement>(
    component: { props: IPopup, rootNode: E | null },
  ): void {
    cleanupRepositioning(component.rootNode as HTMLElement)
  },

  /** Default props for popup elements. */
  defaultProps: {
    anchorPoint: AnchorPoint.Top,
    anchorTo: undefined,
    arrow: false,
  },

  post: true,
}
