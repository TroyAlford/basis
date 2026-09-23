import type { AnchorPoint } from '../types/AnchorPoint'

interface Options {
  anchorPoint: AnchorPoint,
  boundary?: HTMLElement,
  offset?: number,
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
