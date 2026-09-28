import type * as React from 'react'
import { isRefObject, match } from '../../utilities'
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
  /** Optional element that clips the popup, intersected with the viewport. */
  boundary?: HTMLElement | React.RefObject<HTMLElement>,
  /** The offset distance between the popup and reference element. */
  offset?: number,
}

/**
 * Resolves a popup target from an element, ref, or fallback.
 * @param value The element or ref to resolve.
 * @param fallback The element to use when value is empty.
 * @returns The resolved element, or null.
 */
function resolveElement(
  value: HTMLElement | React.RefObject<HTMLElement> | undefined,
  fallback: HTMLElement | null = null,
): HTMLElement | null {
  return match(value)
    .when(isRefObject).then(ref => ref.current)
    .when(el => el instanceof HTMLElement).then(el => el as HTMLElement)
    .else(fallback)
}

const reposition = (
  component: { props: IPopup, rootNode: HTMLElement | SVGElement | null },
) => {
  const { anchorPoint, anchorTo, boundary, offset } = component.props
  const popup = component.rootNode as HTMLElement

  if (!popup) return

  const anchor = resolveElement(anchorTo, popup.parentElement)
  if (!anchor) return

  repositionPopup(popup, anchor, {
    anchorPoint: anchorPoint ?? AnchorPoint.Top,
    boundary: resolveElement(boundary) ?? undefined,
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
  ): void {
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
