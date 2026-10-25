import { match } from '../../utilities'
import type { Component } from '../components/Component/Component'
import type { Mixin } from '../types/Mixin'
import { Pin } from '../types/Pin'

import './Pinnable.styles.ts'

/** Interface for pinnable elements. */
export interface IPinnable {
  /** Pin position for the element. */
  pin?: Pin,
}

/**
 * Format a pixel length.
 * @param value - The length in pixels.
 * @returns The CSS length.
 */
function px(value: number): string {
  return `${value}px`
}

/**
 * The sticky offset for a pinned cell, measured from the widths of the pinned
 * siblings on the same side. Sibling widths are layout facts; the cell's own
 * offset can reflect the current scroll or sticky position and would move the
 * pin when it is re-applied.
 * @param cell - The cell to measure.
 * @param side - The pinned side.
 * @returns The offset in pixels.
 */
function pinnedOffset(cell: HTMLElement, side: 'left' | 'right'): number {
  let offset = 0
  let sibling = side === 'left' ? cell.previousElementSibling : cell.nextElementSibling

  while (sibling) {
    if (sibling instanceof HTMLElement && sibling.dataset.pin === side) {
      offset += sibling.offsetWidth
    }
    sibling = side === 'left' ? sibling.previousElementSibling : sibling.nextElementSibling
  }

  return offset
}

/**
 * Apply pinning logic to a component.
 * @param component - The component to apply pinning logic to.
 */
function apply<E extends HTMLElement | SVGElement, S>(
  component: Component<IPinnable, E, S>,
): void {
  const { pin } = component.props
  const rootNode = component.rootNode as HTMLElement
  if (!rootNode || !pin) return

  match(pin)
    .when(Pin.Left).then(() => {
      delete rootNode.style.right
      rootNode.style.left = px(pinnedOffset(rootNode, 'left'))
    })
    .when(Pin.Right).then(() => {
      delete rootNode.style.left
      rootNode.style.right = px(pinnedOffset(rootNode, 'right'))
    })
    .else(() => {
      delete rootNode.style.left
      delete rootNode.style.right
    })
}

/** Mixin for pinnable elements. */
export const Pinnable: Mixin<IPinnable> = {
  attributes(props): Record<string, string> {
    return {
      'data-pin': props.pin,
    }
  },

  componentDidMount(component): void { apply(component) },
  componentDidUpdate(component): void { apply(component) },

  /** Default props for pinnable elements. */
  defaultProps: {
    pin: Pin.Unpinned,
  },
}
