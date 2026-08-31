import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Lightning } from '../Lightning'
import { Plus } from '../Plus'

describe('IconBase overlay', () => {
  test('places the overlay in the lower-right quadrant of the viewBox', async () => {
    const { node } = await render(<Lightning overlay={Plus} />)
    const overlay = node.querySelector('svg.overlay:not(.mask)')

    expect(overlay).not.toBeNull()
    expect(overlay?.getAttribute('height')).toBe('100')
    expect(overlay?.getAttribute('width')).toBe('100')
    expect(overlay?.getAttribute('x')).toBe('0')
    expect(overlay?.getAttribute('y')).toBe('0')
  })

  test('a component overlay inherits filled from the main icon', async () => {
    const outlined = await render(<Lightning overlay={Plus} />)
    expect(outlined.node.querySelector('svg.overlay:not(.mask) path')?.getAttribute('fill'))
      .toBe('transparent')

    const filled = await render(<Lightning filled overlay={Plus} />)
    expect(filled.node.querySelector('svg.overlay:not(.mask) path')?.getAttribute('fill'))
      .not.toBe('transparent')
  })

  test('an element overlay keeps its own filled', async () => {
    const filledOverlay = await render(<Lightning overlay={<Plus filled />} />)
    expect(filledOverlay.node.querySelector('g[mask] path')?.getAttribute('fill'))
      .toBe('transparent')
    expect(filledOverlay.node.querySelector('svg.overlay:not(.mask) path')?.getAttribute('fill'))
      .not.toBe('transparent')

    const outlinedOverlay = await render(<Lightning filled overlay={<Plus />} />)
    expect(outlinedOverlay.node.querySelector('g[mask] path')?.getAttribute('fill'))
      .not.toBe('transparent')
    expect(outlinedOverlay.node.querySelector('svg.overlay:not(.mask) path')?.getAttribute('fill'))
      .toBe('transparent')
  })

  test('masks the main icon with a filled extra-stroke copy of the overlay', async () => {
    const { node } = await render(<Lightning overlay={Plus} />)
    const mask = node.querySelector('mask')
    const masked = node.querySelector('g[mask]')
    const display = node.querySelector('svg.overlay:not(.mask)')
    const maskOverlay = mask?.querySelector('svg.overlay.mask')

    expect(mask).not.toBeNull()
    expect(masked).not.toBeNull()
    expect(masked?.getAttribute('mask')).toBe(`url(#${mask?.id})`)
    expect(display?.getAttribute('stroke-width')).toBeNull()
    expect(maskOverlay).not.toBeNull()
    expect(maskOverlay?.getAttribute('stroke-width')).toBe('40')
    expect(maskOverlay?.querySelector('path')?.getAttribute('fill')).not.toBe('transparent')
  })
})
