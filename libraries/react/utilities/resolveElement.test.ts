import { describe, expect, test } from 'bun:test'
import type { RefObject } from 'react'
import { resolveElement } from './resolveElement'

/**
 * Builds a div with an optional class name.
 * @param className The class name to apply.
 * @returns The created element.
 */
function element(className?: string): HTMLElement {
  const node = document.createElement('div')
  if (className) node.className = className
  return node
}

describe('resolveElement', () => {
  test('returns a directly provided element', () => {
    const target = element()
    expect(resolveElement(target, element())).toBe(target)
  })

  test('returns the current value of a ref', () => {
    const target = element()
    const ref: RefObject<HTMLElement> = { current: target }
    expect(resolveElement(ref, element())).toBe(target)
  })

  test('resolves a selector to the nearest matching ancestor of the anchor', () => {
    const outer = element('pane scrolling')
    const inner = element('pane')
    const anchor = element()
    outer.append(inner)
    inner.append(anchor)

    expect(resolveElement('.pane', null, anchor)).toBe(inner)
    expect(resolveElement('.scrolling', null, anchor)).toBe(outer)
  })

  test('falls back when a selector matches no ancestor', () => {
    const anchor = element()
    const fallback = element()
    const sibling = element('pane')
    document.body.append(anchor, sibling)

    expect(resolveElement('.pane', fallback, anchor)).toBe(fallback)
    expect(resolveElement('.pane', null, anchor)).toBeNull()
  })

  test('falls back when the value is empty or an unattached ref', () => {
    const fallback = element()
    const ref: RefObject<HTMLElement> = { current: null }

    expect(resolveElement(undefined, fallback)).toBe(fallback)
    expect(resolveElement(ref, fallback)).toBe(fallback)
    expect(resolveElement(undefined)).toBeNull()
  })
})
