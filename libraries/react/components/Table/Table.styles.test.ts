import { describe, expect, test } from 'bun:test'
import { styles } from '../../utilities/style'
import { LIGHT_THEME } from '../Theme/Theme'

import './Table.styles.ts'

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
})
