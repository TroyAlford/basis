import { describe, expect, test } from 'bun:test'
import SVGPathCommander from 'svg-path-commander'
import { ICON_SOURCES, parseViewBox, svgToIconTsx, transformPathData } from './svgToIcon'

describe('parseViewBox', () => {
  test('parses a viewBox attribute', () => {
    expect(parseViewBox('0 0 24 24')).toEqual({ height: 24, width: 24, x: 0, y: 0 })
  })
})

describe('transformPathData', () => {
  test('maps a 24x24 origin path onto the basis viewBox', () => {
    const [d] = transformPathData('M12 12H24', '0 0 24 24')
    expect(d.length).toBeGreaterThan(0)

    const match = /M\s*([-\d.]+)\s+([-\d.]+)/.exec(d)
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBeCloseTo(0, 1)
    expect(Number(match?.[2])).toBeCloseTo(0, 1)
  })

  test('splits compound glyphs into separate path strings', () => {
    const parts = transformPathData('M4 6H8ZM12 6H16Z', '0 0 24 24')
    expect(parts.length).toBe(2)
  })

  test('keeps hole subpaths in a single compound glyph', () => {
    const parts = transformPathData('M0 0H24V24H0ZM8 8H16V16H8Z', '0 0 24 24')
    expect(parts.length).toBe(1)
  })

  test('rebuilds thick TinyMCE bars to Menu-like thickness', () => {
    const [d] = transformPathData('M4 6h16v2H4z', '0 0 24 24')
    const box = new SVGPathCommander(d).getBBox()
    expect(box.height).toBeCloseTo(12, 0)
  })
})

describe('svgToIconTsx', () => {
  test('emits an IconBase class using transformed Path data', () => {
    const svg = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <g fill="none">
          <path d="M4 6h16v2H4z" fill="#000000"></path>
        </g>
      </svg>
    `
    const tsx = svgToIconTsx(svg, 'AlignLeft')

    expect(tsx).toContain('export class AlignLeft extends IconBase')
    expect(tsx).toContain("static displayName = 'AlignLeftIcon'")
    expect(tsx).toContain('fill={filled}')
    expect(tsx).toContain('fillRule="evenodd"')
    expect(tsx).toContain('stroke={filled ? 0 : 10}')
    expect(tsx).toContain('<Path')
    expect(tsx).not.toContain('viewBox="0 0 24 24"')
    expect(tsx).toContain("from './IconBase/IconBase'")
    expect(tsx).toContain("from './parts/Path'")
  })

  test('converts polygon glyphs into Path data', () => {
    const svg = `
      <svg viewBox="0 0 24 24">
        <polygon fill="#000000" points="4 11 20 11 20 13 4 13"></polygon>
      </svg>
    `
    const tsx = svgToIconTsx(svg, 'HorizontalRule')
    expect(tsx).toContain('<Path')
    expect(tsx).toContain('export class HorizontalRule')
  })

  test('skips faded Sketch leftover paths', () => {
    const svg = `
      <svg viewBox="0 0 24 24">
        <path d="M1 1h2v2H1z" opacity=".2" />
        <path d="M4 6h16v2H4z" fill="#000" />
      </svg>
    `
    const tsx = svgToIconTsx(svg, 'AlignLeft')
    expect(tsx.match(/<Path/g)?.length).toBe(1)
  })
})

describe('ICON_SOURCES', () => {
  test('covers the locked TinyMCE editor set', () => {
    expect(Object.keys(ICON_SOURCES).sort()).toEqual([
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
    ])
  })
})
