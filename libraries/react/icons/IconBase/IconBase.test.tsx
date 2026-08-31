import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Lightning } from '../Lightning'
import { Plus } from '../Plus'

describe('IconBase overlay', () => {
  test('places the overlay in the lower-right quadrant of the viewBox', async () => {
    const { node } = await render(<Lightning overlay={Plus} />)
    const overlay = node.querySelector('svg.overlay')

    expect(overlay).not.toBeNull()
    expect(overlay?.getAttribute('height')).toBe('100')
    expect(overlay?.getAttribute('width')).toBe('100')
    expect(overlay?.getAttribute('x')).toBe('0')
    expect(overlay?.getAttribute('y')).toBe('0')
  })

  test('a component overlay inherits filled from the main icon', async () => {
    const outlined = await render(<Lightning overlay={Plus} />)
    expect(outlined.node.querySelector('svg.overlay path')?.getAttribute('fill')).toBe('transparent')

    const filled = await render(<Lightning filled overlay={Plus} />)
    expect(filled.node.querySelector('svg.overlay path')?.getAttribute('fill')).not.toBe('transparent')
  })

  test('an element overlay keeps its own filled', async () => {
    const filledOverlay = await render(<Lightning overlay={<Plus filled />} />)
    expect(filledOverlay.node.querySelector(':scope > g > path')?.getAttribute('fill')).toBe('transparent')
    expect(filledOverlay.node.querySelector('svg.overlay path')?.getAttribute('fill')).not.toBe('transparent')

    const outlinedOverlay = await render(<Lightning filled overlay={<Plus />} />)
    expect(outlinedOverlay.node.querySelector(':scope > g > path')?.getAttribute('fill')).not.toBe('transparent')
    expect(outlinedOverlay.node.querySelector('svg.overlay path')?.getAttribute('fill')).toBe('transparent')
  })
})
