import type * as React from 'react'
import { AnchorPoint } from '../types/AnchorPoint'
import type { Mixin } from '../types/Mixin'
import { cleanupRepositioning, repositionPopup } from '../utilities/repositionPopup'
import { resolveElement } from '../utilities/resolveElement'

import './Popup.styles.ts'

/** Interface for popup elements. */
export interface IPopup {
  /** The anchor point where the popup should be positioned relative to the reference element. */
  anchorPoint?: AnchorPoint,
  /** Optional ref to the element the popup should attach to. If omitted, targets parent element. */
  anchorTo?: HTMLElement | React.RefObject<HTMLElement>,
  /** Whether to show an arrow pointing to the reference element. */
  arrow?: boolean,
  /**
   * Optional element, ref, or CSS selector that clips the popup, intersected
   * with the viewport. A selector is resolved with `closest` from the popup's
   * root element, so it names the nearest matching ancestor of the popup.
   */
  boundary?: HTMLElement | React.RefObject<HTMLElement> | string,
  /** Bound the popup's height to the available viewport space (long content scrolls). */
  constrainHeight?: boolean,
  /** The offset distance between the popup and reference element. */
  offset?: number,
  /** Match the popup's width to its anchor's. */
  sameWidth?: boolean,
}

const reposition = (
  component: { props: IPopup, rootNode: HTMLElement | SVGElement | null },
) => {
  const { anchorPoint, anchorTo, boundary, constrainHeight, offset, sameWidth } = component.props
  const popup = component.rootNode as HTMLElement

  if (!popup) return

  const anchor = resolveElement(anchorTo, popup.parentElement)
  if (!anchor) return

  repositionPopup(popup, anchor, {
    anchorPoint: anchorPoint ?? AnchorPoint.Top,
    /*
     * A selector boundary is searched from the popup's own root: the mixin is
     * always applied to a Component, and the popup lives inside the container
     * that clips it, even when the anchor is supplied from elsewhere.
     */
    boundary: resolveElement(boundary, null, popup) ?? undefined,
    constrainHeight,
    offset: offset ?? 0,
    sameWidth,
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
  ): void {
    /*
     * Reposition after every update: the anchor or boundary element can change
     * without its prop identity changing, and repositionPopup rebinds
     * autoUpdate only when the resolved anchor actually moved.
     */
    reposition(component)
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
    boundary: undefined,
    offset: 0,
  },

  post: true,
}
