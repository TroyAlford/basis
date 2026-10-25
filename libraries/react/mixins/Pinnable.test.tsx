import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { Component } from '../components/Component/Component'
import { render } from '../testing/render'
import type { Mixin } from '../types/Mixin'
import { Pin } from '../types/Pin'
import { Pinnable } from './Pinnable'

interface CellProps {
  id: string,
  pin: Pin,
  revision: number,
}

class PinnedCell extends Component<CellProps> {
  static displayName = 'PinnedCell'
  static get mixins(): Set<Mixin> {
    return super.mixins.add(Pinnable)
  }

  get attributes() {
    return { ...super.attributes, id: this.props.id }
  }

  content(): React.ReactNode {
    return this.props.id
  }
}

/**
 * A row of contiguous left-pinned, unpinned, and right-pinned cells.
 * @param props - The row props.
 * @param props.revision - A changing value that triggers a component update.
 * @returns The row.
 */
function Row({ revision }: { revision: number }): React.ReactElement {
  return (
    <div id="row">
      <PinnedCell id="a" pin={Pin.Left} revision={revision} />
      <PinnedCell id="b" pin={Pin.Left} revision={revision} />
      <PinnedCell id="c" pin={Pin.Unpinned} revision={revision} />
      <PinnedCell id="d" pin={Pin.Right} revision={revision} />
      <PinnedCell id="e" pin={Pin.Right} revision={revision} />
    </div>
  )
}

/**
 * Read the cells in the order they appear in the row.
 * @param node - The rendered row.
 * @returns The cells.
 */
function cells(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll('#row > *')) as HTMLElement[]
}

/**
 * Override a layout metric that Happy DOM does not calculate.
 * @param element - The element to measure.
 * @param property - The metric name.
 * @param value - The metric value.
 */
function measure(element: HTMLElement, property: 'offsetLeft' | 'offsetWidth', value: number): void {
  Object.defineProperty(element, property, { configurable: true, value })
}

describe('Pinnable', () => {
  test('positions pinned cells from sibling widths, not scroll-sensitive metrics', async () => {
    const rendered = await render(<Row revision={0} />)
    const row = rendered.node as HTMLElement
    const [a, b, c, d, e] = cells(row)

    measure(a, 'offsetWidth', 80)
    measure(b, 'offsetWidth', 120)
    measure(c, 'offsetWidth', 100)
    measure(d, 'offsetWidth', 90)
    measure(e, 'offsetWidth', 60)
    measure(row, 'offsetWidth', 2000)

    // Misleading scroll/sort metrics; pin offsets must ignore them.
    measure(a, 'offsetLeft', 900)
    measure(b, 'offsetLeft', 901)
    measure(c, 'offsetLeft', 902)
    measure(d, 'offsetLeft', 903)
    measure(e, 'offsetLeft', 904)

    await rendered.update(<Row revision={1} />)

    expect(a.style.left).toBe('0px')
    expect(b.style.left).toBe('80px')
    expect(c.style.left).toBe('')
    expect(c.style.right).toBe('')
    expect(d.style.right).toBe('60px')
    expect(e.style.right).toBe('0px')
    expect(a.style.right).toBe('')
    expect(e.style.left).toBe('')

    // A later scroll or sort changes these metrics again; the pin must not move.
    measure(a, 'offsetLeft', 100)
    measure(b, 'offsetLeft', 400)
    measure(d, 'offsetLeft', 777)
    measure(e, 'offsetLeft', 999)
    measure(row, 'offsetWidth', 222)

    await rendered.update(<Row revision={2} />)

    expect(b.style.left).toBe('80px')
    expect(d.style.right).toBe('60px')
    expect(e.style.right).toBe('0px')
  })
})
