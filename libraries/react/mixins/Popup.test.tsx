import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { RefObject } from 'react'
import * as React from 'react'
import { AnchorPoint } from '../types/AnchorPoint'

interface PositioningOptions {
  anchorPoint?: AnchorPoint,
  boundary?: HTMLElement,
  constrainHeight?: boolean,
  offset?: number,
  sameWidth?: boolean,
}

interface Positioned {
  anchor: HTMLElement,
  options: PositioningOptions | undefined,
  popup: HTMLElement,
}

interface PopupProps {
  anchorPoint?: AnchorPoint,
  anchorTo?: HTMLElement | RefObject<HTMLElement>,
  boundary?: HTMLElement | RefObject<HTMLElement> | string,
  constrainHeight?: boolean,
  offset?: number,
  sameWidth?: boolean,
}

const positioned: Positioned[] = []
const cleanedUp: HTMLElement[] = []

/*
 * Capture what the Popup mixin hands to Floating UI instead of running it, so
 * every targeting and option decision can be asserted directly.
 */
mock.module('../utilities/repositionPopup', () => ({
  cleanupRepositioning: (popup: HTMLElement) => {
    cleanedUp.push(popup)
  },
  repositionPopup: async (
    popup: HTMLElement,
    anchor: HTMLElement,
    options?: PositioningOptions,
  ) => {
    positioned.push({ anchor, options, popup })
  },
}))

const { Popup } = await import('./Popup')
const { render } = await import('../testing/render')
const { Tooltip } = await import('../components/Tooltip/Tooltip')

interface MixinComponent {
  props: PopupProps,
  rootNode: HTMLElement | null,
}

const didMount = Popup.componentDidMount as unknown as (component: MixinComponent) => void
const didUpdate = Popup.componentDidUpdate as unknown as (component: MixinComponent) => void
const willUnmount = Popup.componentWillUnmount as unknown as (component: MixinComponent) => void

const mounted: HTMLElement[] = []

/**
 * Returns the most recent positioning call.
 * @returns The captured positioning call.
 */
function lastPosition(): Positioned {
  const last = positioned[positioned.length - 1]
  if (!last) throw new Error('repositionPopup was not called')
  return last
}

/**
 * Mounts a popup directly through the mixin's lifecycle.
 * @param overrides Props to apply to the popup.
 * @returns The popup, its parent, and the props.
 */
function mount(overrides: PopupProps = {}): { parent: HTMLElement, popup: HTMLElement, props: PopupProps } {
  const parent = document.createElement('div')
  const popup = document.createElement('div')
  parent.append(popup)
  document.body.append(parent)
  mounted.push(parent)

  const props = { ...overrides }
  didMount({ props, rootNode: popup })
  return { parent, popup, props }
}

afterEach(() => {
  for (const node of mounted) node.remove()
  mounted.length = 0
  positioned.length = 0
  cleanedUp.length = 0
})

describe('Popup mixin contract', () => {
  test('declares the popup data attributes', () => {
    expect(Popup.attributes?.({ anchorPoint: AnchorPoint.Bottom, arrow: true })).toEqual({
      'data-popup': true,
      'data-popup-anchor-point': AnchorPoint.Bottom,
      'data-popup-arrow': true,
    })
    expect(Popup.attributes?.({})['data-popup-arrow']).toBe(false)
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

  test('marks the popup and positions against its parent on mount', () => {
    const { parent, popup } = mount()

    expect(popup.getAttribute('popover')).toBe('manual')
    expect(lastPosition().popup).toBe(popup)
    expect(lastPosition().anchor).toBe(parent)
    expect(lastPosition().options).toEqual({
      anchorPoint: AnchorPoint.Top,
      boundary: undefined,
      constrainHeight: undefined,
      offset: 0,
      sameWidth: undefined,
    })
  })

  test('resolves an element anchor', () => {
    const anchor = document.createElement('div')
    mount({ anchorTo: anchor })

    expect(lastPosition().anchor).toBe(anchor)
  })

  test('resolves a ref anchor to its current element', () => {
    const anchor = document.createElement('div')
    const ref: RefObject<HTMLElement> = { current: anchor }
    mount({ anchorTo: ref })

    expect(lastPosition().anchor).toBe(anchor)
  })

  test('repositions and re-resolves on every update', () => {
    const anchor = document.createElement('div')
    const boundary = document.createElement('div')
    const { popup } = mount()

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

    expect(positioned).toHaveLength(2)
    expect(lastPosition().anchor).toBe(anchor)
    expect(lastPosition().options).toEqual({
      anchorPoint: AnchorPoint.Right,
      boundary,
      constrainHeight: true,
      offset: 12,
      sameWidth: true,
    })
  })

  test('cleans up on unmount', () => {
    const { popup } = mount()
    willUnmount({ props: {}, rootNode: popup })

    expect(cleanedUp).toContain(popup)
  })
})

describe('Popup mixin boundary targeting', () => {
  test('passes an element boundary through to Floating UI', async () => {
    const boundary = document.createElement('div')
    const rendered = await render(<Tooltip boundary={boundary} visible={true}>Content</Tooltip>)

    expect(lastPosition().options?.boundary).toBe(boundary)
    rendered.unmount()
  })

  test('resolves a ref boundary to its current element', async () => {
    const boundary = document.createElement('div')
    const ref: RefObject<HTMLElement> = { current: boundary }
    const rendered = await render(<Tooltip boundary={ref} visible={true}>Content</Tooltip>)

    expect(lastPosition().options?.boundary).toBe(boundary)
    rendered.unmount()
  })

  test('resolves a selector boundary from the popup root, not the anchor', async () => {
    const externalAnchor = document.createElement('button')
    const rendered = await render(
      <div className="popup-boundary-wrapper">
        <Tooltip anchorTo={externalAnchor} boundary=".popup-boundary-wrapper" visible={true}>
          Content
        </Tooltip>
      </div>,
    )

    const wrapper = rendered.node as HTMLElement
    expect(lastPosition().anchor).toBe(externalAnchor)
    expect(lastPosition().options?.boundary).toBe(wrapper)
    rendered.unmount()
  })

  test('drops a selector boundary that matches no ancestor', async () => {
    const rendered = await render(
      <Tooltip boundary=".does-not-exist" visible={true}>Content</Tooltip>,
    )

    expect(lastPosition().options?.boundary).toBeUndefined()
    rendered.unmount()
  })
})
