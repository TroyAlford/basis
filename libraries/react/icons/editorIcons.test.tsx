import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../testing/render'
import type { IconProps } from './IconBase/IconBase'
import { IconBase } from './IconBase/IconBase'

/** The editor formatting and table glyphs added alongside the existing icon set. */
const EDITOR_ICONS = [
  'AlignCenter',
  'AlignJustify',
  'AlignLeft',
  'AlignRight',
  'Bold',
  'ClearFormatting',
  'HorizontalRule',
  'Indent',
  'Italic',
  'ListBulleted',
  'ListChecklist',
  'ListNumbered',
  'Outdent',
  'StrikeThrough',
  'Subscript',
  'Superscript',
  'Table',
  'TableColumnCut',
  'TableColumnDelete',
  'TableColumnDuplicate',
  'TableColumnInsertAfter',
  'TableColumnInsertBefore',
  'TableColumnPasteAfter',
  'TableColumnPasteBefore',
  'TableDelete',
  'TableHeaderLeft',
  'TableHeaderTop',
  'TableMergeCells',
  'TableRowCut',
  'TableRowDelete',
  'TableRowDuplicate',
  'TableRowInsertAbove',
  'TableRowInsertBelow',
  'TableRowPasteAfter',
  'TableRowPasteBefore',
  'TableSplitCells',
  'Underline',
] as const

/**
 * Glyphs that are solid marks: they always render filled and never expose an
 * outline (unfilled) variant.
 */
const SOLID_ICONS: ReadonlySet<string> = new Set([
  'AlignCenter',
  'AlignJustify',
  'AlignLeft',
  'AlignRight',
  'Bold',
  'ClearFormatting',
  'Indent',
  'Italic',
  'ListBulleted',
  'ListChecklist',
  'ListNumbered',
  'Outdent',
  'StrikeThrough',
  'Subscript',
  'Superscript',
  'Table',
  'TableColumnCut',
  'TableColumnDelete',
  'TableColumnDuplicate',
  'TableColumnInsertAfter',
  'TableColumnInsertBefore',
  'TableColumnPasteAfter',
  'TableColumnPasteBefore',
  'TableDelete',
  'TableHeaderLeft',
  'TableHeaderTop',
  'TableMergeCells',
  'TableRowCut',
  'TableRowDelete',
  'TableRowDuplicate',
  'TableRowInsertAbove',
  'TableRowInsertBelow',
  'TableRowPasteAfter',
  'TableRowPasteBefore',
  'TableSplitCells',
  'Underline',
])

describe('editor icons', () => {
  for (const name of EDITOR_ICONS) {
    test(`${name} renders as an IconBase on the basis viewBox`, async () => {
      const module = await import(`./${name}`) as Record<string, unknown>
      const Icon = module[name]
      expect(IconBase.isIcon(Icon)).toBe(true)

      const { node } = await render(React.createElement(Icon as React.ComponentType<IconProps>))
      expect(node.getAttribute('viewBox')).toBe('-100 -100 200 200')

      const path = node.querySelector('path')
      expect(path?.getAttribute('d')?.length).toBeGreaterThan(0)
      expect(path?.getAttribute('fill-rule')).toBe('evenodd')

      /*
       * Solid glyphs never outline; the rest outline at 10. Both drop the stroke
       * when filled so fill and stroke do not double-ink the shape.
       */
      if (SOLID_ICONS.has(name)) {
        expect(path?.getAttribute('stroke-width')).toBe('0')
        expect(path?.getAttribute('fill')).not.toBe('transparent')
      } else {
        expect(path?.getAttribute('stroke-width')).toBe('10')
      }

      const { node: filled } = await render(
        React.createElement(Icon as React.ComponentType<IconProps>, { filled: true }),
      )
      expect(filled.querySelector('path')?.getAttribute('stroke-width')).toBe('0')
    })
  }
})
