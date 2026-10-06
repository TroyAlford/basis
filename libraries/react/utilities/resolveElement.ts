import type { RefObject } from 'react'
import { isRefObject } from '../../utilities/functions/isRefObject'
import { match } from '../../utilities/functions/match'

/**
 * Normalizes an element, a ref, or a CSS selector into an `HTMLElement`.
 *
 * A selector is matched with {@link Element.closest} starting at `closestFrom`,
 * so it names an ancestor of that element. A value that resolves to nothing —
 * an empty value, an unattached ref, or a selector with no matching ancestor —
 * yields `fallback` (or null when no fallback is given).
 * @param value The element, ref, or selector to resolve.
 * @param fallback The element to use when the value resolves to nothing.
 * @param closestFrom The element to search up from for a selector value.
 * @returns The resolved element, or null.
 * @example
 * resolveElement(pane)                       // the element itself
 * resolveElement(paneRef)                    // paneRef.current
 * resolveElement('.scrolling-pane', null, anchor) // nearest matching ancestor
 * resolveElement('.missing', null, anchor)   // null
 */
export function resolveElement(
  value: HTMLElement | RefObject<HTMLElement> | string | undefined,
  fallback: HTMLElement | null = null,
  closestFrom: HTMLElement | null = null,
): HTMLElement | null {
  if (typeof value === 'string') {
    const closest = closestFrom?.closest(value)
    return closest instanceof HTMLElement ? closest : fallback
  }

  return match(value)
    .when(isRefObject).then(ref => ref.current)
    .when(el => el instanceof HTMLElement).then(el => el as HTMLElement)
    .else(fallback)
}
