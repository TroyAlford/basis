import { afterEach, expect, mock, test } from 'bun:test'
import { AnchorPoint } from '../types/AnchorPoint'

interface ComputeOptions {
  middleware: unknown[],
  placement?: string,
}

interface AutoUpdateBinding {
  anchor: HTMLElement,
  callback: () => void,
  popup: HTMLElement,
  stopped: boolean,
}

let computeResult: {
  middlewareData: { offset?: { placement?: string }, shift?: { x?: number, y?: number } },
  x: number,
  y: number,
} = { middlewareData: {}, x: 0, y: 0 }
let floating: HTMLElement | null = null
let applySize: ((data: unknown) => void) | null = null
let autoPlacementCalls = 0
let computeCalls: ComputeOptions[] = []
let offsetArgs: unknown[] = []
let flipArgs: unknown[] = []
let shiftArgs: unknown[] = []
let autoUpdateBindings: AutoUpdateBinding[] = []
const popups: HTMLElement[] = []

/*
 * Fake Floating UI so our positioning policy can be asserted without a browser:
 * the mocked `computePosition` runs the `size` middleware's `apply` against the
 * popup element, exactly as the real one would.
 */
mock.module('@floating-ui/dom', () => ({
  autoPlacement: () => {
    autoPlacementCalls += 1
    return {}
  },
  autoUpdate: (anchor: HTMLElement, popup: HTMLElement, callback: () => void) => {
    const binding: AutoUpdateBinding = { anchor, callback, popup, stopped: false }
    autoUpdateBindings.push(binding)
    return () => {
      binding.stopped = true
    }
  },
  computePosition: async (_reference: unknown, _floating: unknown, options: ComputeOptions) => {
    computeCalls.push(options)
    applySize?.({
      availableHeight: 120,
      elements: { floating },
      rects: { reference: { width: 250 } },
    })
    return computeResult
  },
  flip: (options: unknown) => {
    flipArgs.push(options)
    return {}
  },
  limitShift: () => ({}),
  offset: (value: unknown) => {
    offsetArgs.push(value)
    return {}
  },
  shift: (options: unknown) => {
    shiftArgs.push(options)
    return {}
  },
  size: (options: { apply: (data: unknown) => void }) => {
    applySize = options.apply
    return {}
  },
}))

const { cleanupRepositioning, repositionPopup } = await import('./repositionPopup')

/**
 * Creates a popup element tracked for cleanup.
 * @returns The popup element.
 */
function popupElement(): HTMLElement {
  const popup = document.createElement('div')
  popups.push(popup)
  return popup
}

/**
 * Waits a macrotask so dynamic-import continuations flush.
 * @returns A promise resolved on the next macrotask.
 */
function flush(): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, 0) })
}

afterEach(async () => {
  for (const popup of popups) cleanupRepositioning(popup)
  popups.length = 0
  computeResult = { middlewareData: {}, x: 0, y: 0 }
  floating = null
  applySize = null
  autoPlacementCalls = 0
  computeCalls = []
  offsetArgs = []
  flipArgs = []
  shiftArgs = []
  autoUpdateBindings = []
  await flush()
})

test('sizes a popup to its anchor and clears that sizing when disabled', async () => {
  const popup = popupElement()
  const anchor = document.createElement('div')
  floating = popup

  await repositionPopup(popup, anchor, {
    anchorPoint: AnchorPoint.Top,
    constrainHeight: true,
    sameWidth: true,
  })
  expect(popup.style.width).toBe('250px')
  expect(popup.style.maxHeight).toBe('120px')

  await repositionPopup(popup, anchor, {
    anchorPoint: AnchorPoint.Top,
    constrainHeight: false,
    sameWidth: false,
  })
  expect(popup.style.width).toBe('')
  expect(popup.style.maxHeight).toBe('')
})

test('matches the anchor width without constraining the height', async () => {
  const popup = popupElement()
  const anchor = document.createElement('div')
  floating = popup

  await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.Top, sameWidth: true })
  expect(popup.style.width).toBe('250px')
  expect(popup.style.maxHeight).toBe('')
})

test('applies coordinates, anchor placement, and shift offsets', async () => {
  const popup = popupElement()
  const anchor = document.createElement('div')
  computeResult = {
    middlewareData: { offset: { placement: 'bottom-start' }, shift: { x: 12, y: -4 } },
    x: 30,
    y: 40,
  }

  await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.Top })

  expect(popup.style.left).toBe('30px')
  expect(popup.style.top).toBe('40px')
  expect(popup.dataset.popupAnchorPoint).toBe('bottom-start')
  expect(popup.style.getPropertyValue('--popup-shift-x')).toBe('12px')
  expect(popup.style.getPropertyValue('--popup-shift-y')).toBe('-4px')
})

test('auto-places only when no anchor point is provided', async () => {
  const popup = popupElement()
  const anchor = document.createElement('div')

  await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.Top })
  expect(autoPlacementCalls).toBe(0)

  await repositionPopup(popup, anchor, undefined)
  expect(autoPlacementCalls).toBe(1)
  expect(computeCalls[computeCalls.length - 1].placement).toBe('top')
})

test('defaults the offset to -8 and passes a provided offset through', async () => {
  const popup = popupElement()
  const anchor = document.createElement('div')

  await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.Top })
  expect(offsetArgs[offsetArgs.length - 1]).toBe(-8)

  await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.Top, offset: 24 })
  expect(offsetArgs[offsetArgs.length - 1]).toBe(24)
})

test('clips both flip and shift to the boundary visible box', async () => {
  const popup = popupElement()
  const anchor = document.createElement('div')
  const boundary = document.createElement('div')
  boundary.getBoundingClientRect = () => ({ left: 10, top: 20 } as DOMRect)
  Object.defineProperties(boundary, {
    clientHeight: { configurable: true, value: 100 },
    clientLeft: { configurable: true, value: 2 },
    clientTop: { configurable: true, value: 3 },
    clientWidth: { configurable: true, value: 200 },
  })

  await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.Top, boundary })

  const rect = { height: 100, width: 200, x: 12, y: 23 }
  expect(flipArgs[flipArgs.length - 1]).toEqual({ boundary: rect, rootBoundary: rect })
  expect(shiftArgs[shiftArgs.length - 1]).toEqual({
    boundary: rect,
    limiter: {},
    rootBoundary: rect,
  })
})

test('binds auto-update once per anchor, rebinds on change, and stops on cleanup', async () => {
  const popup = popupElement()
  const anchor = document.createElement('div')
  const other = document.createElement('div')

  await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.Top })
  expect(autoUpdateBindings).toHaveLength(1)

  await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.Top })
  expect(autoUpdateBindings).toHaveLength(1)

  await repositionPopup(popup, other, { anchorPoint: AnchorPoint.Top })
  expect(autoUpdateBindings).toHaveLength(2)
  expect(autoUpdateBindings[0].stopped).toBe(true)

  cleanupRepositioning(popup)
  expect(autoUpdateBindings[1].stopped).toBe(true)

  await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.Top })
  expect(autoUpdateBindings).toHaveLength(3)
})

test('repositions when auto-update fires, and no-ops after cleanup', async () => {
  const popup = popupElement()
  const anchor = document.createElement('div')
  await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.Top })

  const binding = autoUpdateBindings[autoUpdateBindings.length - 1]
  const before = computeCalls.length
  binding.callback()
  await flush()
  expect(computeCalls.length).toBeGreaterThan(before)

  cleanupRepositioning(popup)
  const afterCleanup = computeCalls.length
  binding.callback()
  await flush()
  expect(computeCalls.length).toBe(afterCleanup)
})

test('cleanup tolerates a popup that was never positioned', () => {
  expect(() => cleanupRepositioning(document.createElement('div'))).not.toThrow()
})
