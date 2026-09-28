import type { AnchorPoint } from '../types/AnchorPoint'

interface Options {
  anchorPoint: AnchorPoint,
  /** Bound the popup's height to the available viewport space. */
  constrainHeight?: boolean,
  offset?: number,
  /** Match the popup's width to the anchor's. */
  sameWidth?: boolean,
}

const OPTIONS = new Map<HTMLElement, Options>()
const UPDATERS = new Map<HTMLElement, () => void>()

/**
 * Positions the popup element using Floating UI with auto-repositioning and arrow support.
 * @param popup The popup element to position.
 * @param anchorTo The reference element (anchor or parent).
 * @param options Options for the positioning.
 */
export async function repositionPopup(
  popup: HTMLElement,
  anchorTo: HTMLElement,
  options?: Options,
): Promise<void> {
  const {
    arrow,
    autoPlacement,
    autoUpdate,
    computePosition,
    flip,
    limitShift,
    offset,
    shift,
    size,
  } = await import('@floating-ui/dom')

  OPTIONS.set(popup, options)
  if (!UPDATERS.has(popup)) {
    UPDATERS.set(popup, autoUpdate(anchorTo, popup, async () => {
      await repositionPopup(popup, anchorTo, OPTIONS.get(popup))
    }))
  }

  const middleware = [
    arrow({ element: anchorTo }),
    flip(),
    offset(options?.offset ?? -8),
    shift({ limiter: limitShift() }),
  ]

  /*
   * A popup promoted to the browser top layer resolves percentage sizes against
   * the viewport, so a consumer cannot match the anchor width in CSS. Sizing
   * here (via Floating UI) lets a combobox line its dropdown up with its editor
   * and keep it inside the viewport instead of running off-screen.
   */
  if (options?.sameWidth || options?.constrainHeight) {
    middleware.push(size({
      apply({ availableHeight, elements, rects }) {
        if (options.sameWidth) {
          elements.floating.style.width = `${rects.reference.width}px`
        }
        if (options.constrainHeight) {
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`
        }
      },
    }))
  }

  // Add auto-placement if no specific placement is provided
  if (!options?.anchorPoint) {
    middleware.unshift(autoPlacement())
  }

  const { middlewareData, x, y } = await computePosition(anchorTo, popup, {
    middleware,
    placement: options?.anchorPoint || 'top',
  })

  // Apply the computed position
  Object.assign(popup.style, {
    left: `${x}px`,
    top: `${y}px`,
  })

  /*
   * Clear sizing this function previously wrote when the matching options are
   * turned off, so a popup does not keep a stale inline width/height.
   */
  if (!options?.sameWidth) popup.style.removeProperty('width')
  if (!options?.constrainHeight) popup.style.removeProperty('max-height')

  popup.dataset.popupAnchorPoint = middlewareData.offset?.placement
  popup.style.setProperty('--popup-shift-x', `${middlewareData.shift?.x}px`)
  popup.style.setProperty('--popup-shift-y', `${middlewareData.shift?.y}px`)
}

/**
 * Cleanup the repositioning of the popup.
 * @param popup The popup element to cleanup.
 */
export function cleanupRepositioning(popup: HTMLElement) {
  UPDATERS.get(popup)?.()
  UPDATERS.delete(popup)
}
