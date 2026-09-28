import { afterEach, describe, expect, test } from 'bun:test'
import { AnchorPoint } from '../types/AnchorPoint'
import { cleanupRepositioning, repositionPopup } from './repositionPopup'

interface Box {
  height: number,
  width: number,
  x: number,
  y: number,
}

/**
 * Applies a mocked client rect and box model to an element.
 * @param element The element to mock.
 * @param rect The box to apply.
 */
function box(element: HTMLElement, rect: Box): void {
  const { height, width, x, y } = rect
  const client = {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    toJSON: () => rect,
    top: y,
    width,
    x,
    y,
  }
  element.getBoundingClientRect = () => client as DOMRect
  element.getClientRects = () => [client] as unknown as DOMRectList
  Object.defineProperties(element, {
    clientHeight: { configurable: true, get: () => height },
    clientWidth: { configurable: true, get: () => width },
    offsetHeight: { configurable: true, get: () => height },
    offsetWidth: { configurable: true, get: () => width },
    scrollHeight: { configurable: true, get: () => height },
    scrollWidth: { configurable: true, get: () => width },
  })
}

describe('repositionPopup', () => {
  const nodes: HTMLElement[] = []

  afterEach(() => {
    for (const node of nodes) {
      cleanupRepositioning(node)
      node.remove()
    }
    nodes.length = 0
  })

  /**
   * Creates a DOM node, appends it to the document, and tracks it for cleanup.
   * @param tag The element tag name.
   * @returns The created element.
   */
  function mount(tag = 'div'): HTMLElement {
    const node = document.createElement(tag)
    document.body.append(node)
    nodes.push(node)
    return node
  }

  test('writes left and top from Floating UI', async () => {
    const anchor = mount()
    const popup = mount()
    box(anchor, { height: 20, width: 80, x: 40, y: 80 })
    box(popup, { height: 24, width: 48, x: 0, y: 0 })

    await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.TopEnd, offset: 8 })

    expect(popup.style.left).toMatch(/px$/)
    expect(popup.style.top).toMatch(/px$/)
  })

  test('keeps the popup inside a custom boundary instead of the viewport', async () => {
    const boundary = mount()
    const anchor = mount()
    const popup = mount()
    box(boundary, { height: 400, width: 120, x: 200, y: 0 })
    box(anchor, { height: 20, width: 80, x: 200, y: 80 })
    box(popup, { height: 24, width: 150, x: 0, y: 0 })

    await repositionPopup(popup, anchor, { anchorPoint: AnchorPoint.TopEnd, offset: 8 })
    expect(Number.parseFloat(popup.style.left)).toBeLessThan(200)

    await repositionPopup(popup, anchor, {
      anchorPoint: AnchorPoint.TopEnd,
      boundary,
      offset: 8,
    })
    expect(Number.parseFloat(popup.style.left)).toBeGreaterThanOrEqual(200)
  })

  test('flips below the anchor when the boundary has no room above', async () => {
    const boundary = mount()
    const anchor = mount()
    const popup = mount()
    box(boundary, { height: 200, width: 400, x: 0, y: 200 })
    box(anchor, { height: 20, width: 80, x: 40, y: 208 })
    box(popup, { height: 40, width: 100, x: 0, y: 0 })

    await repositionPopup(popup, anchor, {
      anchorPoint: AnchorPoint.TopEnd,
      boundary,
      offset: 8,
    })

    expect(Number.parseFloat(popup.style.top)).toBeGreaterThanOrEqual(228)
  })
})
