import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { RefObject } from 'react'
import * as React from 'react'
import { AnchorPoint } from '../types/AnchorPoint'

interface Box {
  height: number,
  width: number,
  x: number,
  y: number,
}

interface ComputeCall {
  placement?: string,
  reference: HTMLElement,
}

interface MixinComponent {
  props: PopupProps,
  rootNode: HTMLElement | null,
}

interface PopupProps {
  anchorPoint?: AnchorPoint,
  anchorTo?: HTMLElement | RefObject<HTMLElement>,
  boundary?: HTMLElement | RefObject<HTMLElement> | string,
  constrainHeight?: boolean,
  offset?: number,
  sameWidth?: boolean,
}

let floating: HTMLElement | null = null
let applySize: ((data: unknown) => void) | null = null
let autoUpdateStops = 0
let computeCalls: ComputeCall[] = []
let offsetArgs: unknown[] = []
let flipArgs: unknown[] = []
let shiftArgs: unknown[] = []

/*
 * Capture the decisions the Popup mixin makes at the Floating UI boundary
 * instead of mocking our own repositionPopup module. Module mocks are global to
 * the test process, so mocking the third-party module here cannot corrupt the
 * sibling suites the way mocking our module would.
 */
mock.module('@floating-ui/dom', () => ({
  autoPlacement: () => ({}),
  autoUpdate: () => () => {
    autoUpdateStops += 1
  },
  computePosition: async (
    reference: HTMLElement,
    _floating: HTMLElement,
    options: { placement?: string },
  ) => {
    computeCalls.push({ placement: options?.placement, reference })
    /*
     * Guard against a null floating element: this mock can leak process-wide
     * (module mocks are not isolated), and production `size.apply` asserts a
     * real element. Skipping the sizing keeps a leaked mock harmless.
     */
    if (floating) {
      applySize?.({
        availableHeight: 120,
        elements: { floating },
        rects: { reference: { width: 250 } },
      })
    }
    return { middlewareData: {}, x: 0, y: 0 }
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

const { Popup } = await import('./Popup')
const { cleanupRepositioning } = await import('../utilities/repositionPopup')
const { render } = await import('../testing/render')
const { Tooltip } = await import('../components/Tooltip/Tooltip')

const didMount = Popup.componentDidMount as unknown as (component: MixinComponent) => void
const didUpdate = Popup.componentDidUpdate as unknown as (component: MixinComponent) => void
const willUnmount = Popup.componentWillUnmount as unknown as (component: MixinComponent) => void

/**
 * Waits a macrotask so the dynamic positioning continuations flush.
 * @returns A promise resolved on the next macrotask.
 */
function flush(): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, 0) })
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
    clientLeft: { configurable: true, get: () => 0 },
    clientTop: { configurable: true, get: () => 0 },
    clientWidth: { configurable: true, get: () => width },
  })
}

/**
 * Computes the overflow rect the Popup mixin derives from a boundary element.
 * @param element The boundary element.
 * @returns The expected overflow rect.
 */
function boundaryRect(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return {
    height: element.clientHeight,
    width: element.clientWidth,
    x: rect.left + element.clientLeft,
    y: rect.top + element.clientTop,
  }
}

const mounted: HTMLElement[] = []
const popups: HTMLElement[] = []

/**
 * Mounts a popup through the mixin lifecycle.
 * @param overrides Props to apply to the popup.
 * @returns The popup and its parent.
 */
function mount(overrides: PopupProps = {}): { parent: HTMLElement, popup: HTMLElement } {
  const parent = document.createElement('div')
  const popup = document.createElement('div')
  parent.append(popup)
  document.body.append(parent)
  mounted.push(parent)
  popups.push(popup)

  didMount({ props: { ...overrides }, rootNode: popup })
  return { parent, popup }
}

afterEach(async () => {
  for (const popup of popups) cleanupRepositioning(popup)
  popups.length = 0
  for (const node of mounted) node.remove()
  mounted.length = 0
  floating = null
  applySize = null
  autoUpdateStops = 0
  computeCalls = []
  offsetArgs = []
  flipArgs = []
  shiftArgs = []
  await flush()
})

describe('Popup mixin contract', () => {
  test('declares the popup data attributes', () => {
    const attributes = Popup.attributes?.({ anchorPoint: AnchorPoint.Bottom, arrow: true })
    expect(attributes).toEqual({
      'data-popup': true,
      'data-popup-anchor-point': AnchorPoint.Bottom,
      'data-popup-arrow': true,
    })
    expect(Popup.attributes?.({})?.['data-popup-arrow']).toBe(false)
  })

  test('provides defaults and runs post', () => {
    expect(Popup.defaultProps).toEqual({
      anchorPoint: AnchorPoint.Top,
      anchorTo: undefined,
      arrow: false,
      boundary: undefined,
      offset: 0,
    })
    expect(Popup.post).toBe(true)
  })

  test('marks the popup and positions against its parent on mount', async () => {
    const { parent, popup } = mount()
    await flush()

    expect(popup.getAttribute('popover')).toBe('manual')
    expect(computeCalls.at(-1)?.reference).toBe(parent)
    expect(computeCalls.at(-1)?.placement).toBe(AnchorPoint.Top)
    expect(offsetArgs.at(-1)).toBe(0)
    expect(flipArgs.at(-1)).toBeUndefined()
  })

  test('resolves an element anchor', async () => {
    const anchor = document.createElement('div')
    mount({ anchorTo: anchor })
    await flush()

    expect(computeCalls.at(-1)?.reference).toBe(anchor)
  })

  test('resolves a ref anchor to its current element', async () => {
    const anchor = document.createElement('div')
    const ref: RefObject<HTMLElement> = { current: anchor }
    mount({ anchorTo: ref })
    await flush()

    expect(computeCalls.at(-1)?.reference).toBe(anchor)
  })

  test('repositions and maps every option on update', async () => {
    const anchor = document.createElement('div')
    const boundary = document.createElement('div')
    box(boundary, { height: 100, width: 200, x: 10, y: 20 })
    const { popup } = mount()
    await flush()
    floating = popup

    didUpdate({
      props: {
        anchorPoint: AnchorPoint.Right,
        anchorTo: anchor,
        boundary,
        constrainHeight: true,
        offset: 12,
        sameWidth: true,
      },
      rootNode: popup,
    })
    await flush()

    expect(computeCalls.at(-1)?.reference).toBe(anchor)
    expect(computeCalls.at(-1)?.placement).toBe(AnchorPoint.Right)
    expect(offsetArgs.at(-1)).toBe(12)

    const rect = boundaryRect(boundary)
    expect(flipArgs.at(-1)).toEqual({ boundary: rect, rootBoundary: rect })
    expect(shiftArgs.at(-1)).toMatchObject({ boundary: rect, rootBoundary: rect })

    expect(popup.style.width).toBe('250px')
    expect(popup.style.maxHeight).toBe('120px')
  })

  test('cleans up on unmount', async () => {
    const { popup } = mount()
    await flush()

    const before = autoUpdateStops
    willUnmount({ props: {}, rootNode: popup })
    expect(autoUpdateStops).toBe(before + 1)
  })
})

describe('Popup mixin boundary targeting', () => {
  test('passes an element boundary through to the overflow middleware', async () => {
    const boundary = document.createElement('div')
    box(boundary, { height: 40, width: 50, x: 1, y: 2 })
    const rendered = await render(<Tooltip boundary={boundary} visible={true}>Content</Tooltip>)
    await flush()

    const rect = boundaryRect(boundary)
    expect(flipArgs.at(-1)).toEqual({ boundary: rect, rootBoundary: rect })
    rendered.unmount()
  })

  test('resolves a ref boundary to its current element', async () => {
    const boundary = document.createElement('div')
    box(boundary, { height: 40, width: 50, x: 3, y: 4 })
    const ref: RefObject<HTMLElement> = { current: boundary }
    const rendered = await render(<Tooltip boundary={ref} visible={true}>Content</Tooltip>)
    await flush()

    const rect = boundaryRect(boundary)
    expect(flipArgs.at(-1)).toEqual({ boundary: rect, rootBoundary: rect })
    rendered.unmount()
  })

  test('resolves a selector boundary from the popup root, not an external anchor', async () => {
    const externalAnchor = document.createElement('button')
    const rendered = await render(
      <div className="popup-boundary-wrapper">
        <Tooltip anchorTo={externalAnchor} boundary=".popup-boundary-wrapper" visible={true}>Content</Tooltip>
      </div>,
    )
    await flush()

    expect(computeCalls.at(-1)?.reference).toBe(externalAnchor)
    /*
     * The external anchor has no matching ancestor, so a boundary resolved from
     * it would be undefined. A defined boundary proves the popup root was used.
     */
    expect(flipArgs.at(-1)).toBeDefined()
    rendered.unmount()
  })

  test('drops a selector boundary that matches no ancestor', async () => {
    const rendered = await render(
      <Tooltip boundary=".does-not-exist" visible={true}>Content</Tooltip>,
    )
    await flush()

    expect(flipArgs.at(-1)).toBeUndefined()
    rendered.unmount()
  })
})
