import { match } from '@basis/utilities'
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
      rootNode.style.left = `${CSS.px(rootNode.offsetLeft)}`
    })
    .when(Pin.Right).then(() => {
      delete rootNode.style.left
      // Calculate right position: parent width - (element left + element width)
      const parent = rootNode.parentElement
      if (parent) {
        const parentWidth = parent.offsetWidth
        const elementLeft = rootNode.offsetLeft
        const elementWidth = rootNode.offsetWidth
        const rightPosition = parentWidth - elementLeft - elementWidth
        rootNode.style.right = `${CSS.px(rightPosition)}`
      } else {
        rootNode.style.right = `${CSS.px(0)}`
      }
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
