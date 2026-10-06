import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { RefObject } from 'react'
import * as React from 'react'

interface Positioned {
  anchor: HTMLElement,
  boundary: HTMLElement | undefined,
  popup: HTMLElement,
}

const positioned: Positioned[] = []

/*
 * Capture what the Popup mixin hands to Floating UI instead of running it, so
 * each boundary targeting method can be asserted directly.
 */
mock.module('../utilities/repositionPopup', () => ({
  cleanupRepositioning: () => undefined,
  repositionPopup: async (
    popup: HTMLElement,
    anchor: HTMLElement,
    options?: { boundary?: HTMLElement },
  ) => {
    positioned.push({ anchor, boundary: options?.boundary, popup })
  },
}))

const { render } = await import('../testing/render')
const { Tooltip } = await import('../components/Tooltip/Tooltip')

/**
 * Returns the most recent positioning call.
 * @returns The captured positioning call.
 */
function lastPosition(): Positioned {
  const last = positioned[positioned.length - 1]
  if (!last) throw new Error('repositionPopup was not called')
  return last
}

describe('Popup mixin boundary targeting', () => {
  afterEach(() => {
    positioned.length = 0
  })

  test('passes an element boundary through to Floating UI', async () => {
    const boundary = document.createElement('div')
    const rendered = await render(<Tooltip boundary={boundary} visible={true}>Content</Tooltip>)

    expect(lastPosition().boundary).toBe(boundary)
    rendered.unmount()
  })

  test('resolves a ref boundary to its current element', async () => {
    const boundary = document.createElement('div')
    const ref: RefObject<HTMLElement> = { current: boundary }
    const rendered = await render(<Tooltip boundary={ref} visible={true}>Content</Tooltip>)

    expect(lastPosition().boundary).toBe(boundary)
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
    expect(lastPosition().boundary).toBe(wrapper)
    rendered.unmount()
  })

  test('drops a selector boundary that matches no ancestor', async () => {
    const rendered = await render(
      <Tooltip boundary=".does-not-exist" visible={true}>Content</Tooltip>,
    )

    expect(lastPosition().boundary).toBeUndefined()
    rendered.unmount()
  })
})
