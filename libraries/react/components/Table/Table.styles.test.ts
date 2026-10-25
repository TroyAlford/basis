import { describe, expect, test } from 'bun:test'
import { styles } from '../../utilities/style'

import './Table.styles.ts'

describe('Table styles', () => {
  test('uses an opaque even-row background so pinned cells hide scrolled content', () => {
    const css = styles()

    expect(css).toContain('--basis-table-row-background-even: #ddd')
    expect(css).toMatch(
      /:nth-child\(even\)\s*{\s*background-color:\s*var\(--basis-table-row-background-even\);/,
    )
    expect(css).not.toMatch(/:nth-child\(even\)\s*{\s*background-color:\s*#8883;/)
  })
})
