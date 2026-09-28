import { expect, mock, test } from 'bun:test'
import { AnchorPoint } from '../types/AnchorPoint'

/*
 * Fake Floating UI so the sizing policy can be asserted without a browser: the
 * mocked `computePosition` runs the `size` middleware's `apply` against the
 * popup element, exactly as the real one would.
 */
let floating: HTMLElement | null = null
let applySize: ((data: unknown) => void) | null = null

mock.module('@floating-ui/dom', () => ({
  arrow: () => ({}),
  autoPlacement: () => ({}),
  autoUpdate: () => () => undefined,
  computePosition: async () => {
    applySize?.({
      availableHeight: 120,
      elements: { floating },
      rects: { reference: { width: 250 } },
    })
    return { middlewareData: {}, x: 0, y: 0 }
  },
  flip: () => ({}),
  limitShift: () => ({}),
  offset: () => ({}),
  shift: () => ({}),
  size: (options: { apply: (data: unknown) => void }) => {
    applySize = options.apply
    return {}
  },
}))

const { cleanupRepositioning, repositionPopup } = await import('./repositionPopup')

test('sizes a popup to its anchor and clears that sizing when disabled', async () => {
  const popup = document.createElement('div')
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

  cleanupRepositioning(popup)
})

test('matches the anchor width without constraining the height', async () => {
  const popup = document.createElement('div')
  const anchor = document.createElement('div')
  floating = popup

  await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.Top, sameWidth: true })
  expect(popup.style.width).toBe('250px')
  expect(popup.style.maxHeight).toBe('')

  cleanupRepositioning(popup)
})
