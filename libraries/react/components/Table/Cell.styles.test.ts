import { describe, expect, test } from 'bun:test'
import { styles } from '../../utilities/style'

import './Cell.styles.ts'

describe('Cell styles', () => {
  test('renders inline text and number editors flat against the row background', () => {
    const css = styles()

    expect(css).toMatch(/> \.text-editor,\s*> \.number-editor\s*{[^}]*background-color:\s*transparent;/)
    expect(css).toMatch(/> \.text-editor,\s*> \.number-editor\s*{[^}]*border:\s*none;/)
  })
})
