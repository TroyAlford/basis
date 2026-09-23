import type { AnchorPoint } from '../types/AnchorPoint'

interface Options {
  anchorPoint: AnchorPoint,
  /** Optional element that clips the popup, intersected with the viewport. */
  boundary?: HTMLElement,
  /** Bound the popup's height to the available viewport space. */
  constrainHeight?: boolean,
  offset?: number,
  /** Match the popup's width to the anchor's. */
  sameWidth?: boolean,
}

interface Rect {
  height: number,
  width: number,
  x: number,
  y: number,
}

const ANCHORS = new Map<HTMLElement, HTMLElement>()
const OPTIONS = new Map<HTMLElement, Options | undefined>()
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
  OPTIONS.set(popup, options)
  bindAutoUpdate(popup, anchorTo)
  await updatePosition(popup, anchorTo, options)
}

/**
 * Cleanup the repositioning of the popup.
 * @param popup The popup element to cleanup.
 */
export function cleanupRepositioning(popup: HTMLElement) {
  UPDATERS.get(popup)?.()
  ANCHORS.delete(popup)
  OPTIONS.delete(popup)
  UPDATERS.delete(popup)
}

/**
 * Binds Floating UI auto-update to the current anchor, replacing any previous binding.
 * @param popup The popup element.
 * @param anchorTo The current anchor element.
 */
function bindAutoUpdate(popup: HTMLElement, anchorTo: HTMLElement): void {
  if (ANCHORS.get(popup) === anchorTo && UPDATERS.has(popup)) return

  UPDATERS.get(popup)?.()
  ANCHORS.set(popup, anchorTo)
  UPDATERS.set(popup, () => undefined)

  void import('@floating-ui/dom').then(({ autoUpdate }) => {
    if (ANCHORS.get(popup) !== anchorTo) return
    const stop = autoUpdate(anchorTo, popup, () => {
      const anchor = ANCHORS.get(popup)
      if (!anchor) return
      void updatePosition(popup, anchor, OPTIONS.get(popup))
    })
    UPDATERS.set(popup, stop)
  })
}

/**
 * Computes and applies the popup's coordinates for the current anchor and options.
 * @param popup The popup element.
 * @param anchorTo The reference element.
 * @param options Positioning options.
 */
async function updatePosition(
  popup: HTMLElement,
  anchorTo: HTMLElement,
  options?: Options,
): Promise<void> {
  const {
    autoPlacement,
    computePosition,
    flip,
    limitShift,
    offset,
    shift,
    size,
  } = await import('@floating-ui/dom')

  const overflow = overflowOptions(options?.boundary)

  const middleware = [
    offset(options?.offset ?? -8),
    flip(overflow),
    shift({
      limiter: limitShift(),
      ...overflow,
    }),
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
 * Overflow options that clip only to the boundary's visible box.
 * @param boundary The clipping element.
 * @returns Flip/shift overflow options, or undefined.
 */
function overflowOptions(boundary: HTMLElement | undefined) {
  if (!boundary) return undefined
  const clip = visibleRect(boundary)
  return { boundary: clip, rootBoundary: clip }
}

/**
 * Builds a visible clipping rect from a boundary element.
 * @param element The clipping element.
 * @returns The element's visible client box.
 */
function visibleRect(element: HTMLElement): Rect {
  const box = element.getBoundingClientRect()
  return {
    height: element.clientHeight,
    width: element.clientWidth,
    x: box.left + element.clientLeft,
    y: box.top + element.clientTop,
  }
}
