import { describe, expect, test } from 'bun:test'
import { styles } from '../../utilities/style'
import { LIGHT_THEME } from '../Theme/Theme'

import '../../mixins/Pinnable.styles.ts'
import './Table.styles.ts'

/**
 * Extract one balanced selector block from the registered styles.
 * @param selector - The selector and opening brace that start the block.
 * @returns The block, including its opening and closing braces.
 */
function block(selector: string): string {
  const css = styles()
  const start = css.indexOf(selector)
  expect(start).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  let depth = 0

  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(start, index + 1)
    }
  }

  return ''
}

describe('Table styles', () => {
  test('uses an opaque even-row background so pinned cells hide scrolled content', () => {
    const css = styles()

    expect(css).toContain('var(--basis-table-row-background-even, var(--basis-color-surface-alt))')
    expect(LIGHT_THEME.color.surfaceAlt).toBe('#dddddd')
    expect(css).toMatch(
      /:nth-child\(even\)\s*{\s*background-color:\s*var\(--basis-table-row-background-even/,
    )
    expect(css).toContain('var(--basis-color-surface-alt))')
    expect(css).not.toMatch(/:nth-child\(even\)\s*{\s*background-color:\s*#8883;/)
  })

  test('stacks the sticky header row group above pinned body cells', () => {
    const header = block('thead {')
    const pinnable = block('[data-pin] {')

    /*
     * A table row's z-index is not honored consistently across Chromium, so the
     * header must own its sticky stacking layer at the row group. Pinned body
     * cells stay at their own lower layer, owned by the Pinnable mixin.
     */
    expect(header).toMatch(/position:\s*sticky;/)
    expect(header).toMatch(/top:\s*0;/)

    const headerLayer = Number(/z-index:\s*var\(--basis-table-header-row-z,\s*(\d+)\)/.exec(header)?.[1])
    const pinnedLayer = Number(/z-index:\s*(\d+)/.exec(pinnable)?.[1])

    expect(headerLayer).toBeGreaterThan(pinnedLayer)
  })
})
