#!/usr/bin/env bun

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import SVGPathCommander, { pathToString, roundPath } from 'svg-path-commander'

interface ViewBox {
  height: number,
  width: number,
  x: number,
  y: number,
}

/**
 * TinyMCE SVG filenames for the locked editor icon set, keyed by basis class name.
 */
export const ICON_SOURCES = {
  AlignCenter: 'align-center.svg',
  AlignJustify: 'align-justify.svg',
  AlignLeft: 'align-left.svg',
  AlignRight: 'align-right.svg',
  Bold: 'bold.svg',
  ClearFormatting: 'remove-formatting.svg',
  HorizontalRule: 'horizontal-rule.svg',
  Indent: 'indent.svg',
  Italic: 'italic.svg',
  ListBulleted: 'unordered-list.svg',
  ListChecklist: 'checklist.svg',
  ListNumbered: 'ordered-list.svg',
  Outdent: 'outdent.svg',
  StrikeThrough: 'strike-through.svg',
  Subscript: 'subscript.svg',
  Superscript: 'superscript.svg',
  Table: 'table.svg',
  TableColumnCut: 'cut-column.svg',
  TableColumnDelete: 'table-delete-column.svg',
  TableColumnDuplicate: 'duplicate-column.svg',
  TableColumnInsertAfter: 'table-insert-column-after.svg',
  TableColumnInsertBefore: 'table-insert-column-before.svg',
  TableColumnPasteAfter: 'paste-column-after.svg',
  TableColumnPasteBefore: 'paste-column-before.svg',
  TableDelete: 'table-delete-table.svg',
  TableHeaderLeft: 'table-left-header.svg',
  TableHeaderTop: 'table-top-header.svg',
  TableMergeCells: 'table-merge-cells.svg',
  TableRowCut: 'cut-row.svg',
  TableRowDelete: 'table-delete-row.svg',
  TableRowDuplicate: 'duplicate-row.svg',
  TableRowInsertAbove: 'table-insert-row-above.svg',
  TableRowInsertBelow: 'table-insert-row-after.svg',
  TableRowPasteAfter: 'paste-row-after.svg',
  TableRowPasteBefore: 'paste-row-before.svg',
  TableSplitCells: 'table-split-cells.svg',
  Underline: 'underline.svg',
} as const

/**
 * Converts TinyMCE SVGs into basis IconBase modules on the standard viewBox.
 */
class SvgToIcon {
  private targetBarThickness = 12
  private targetViewBox: ViewBox = { height: 200, width: 200, x: -100, y: -100 }
  private tinyMceSvgBase = 'https://raw.githubusercontent.com/tinymce/tinymce/main/modules/oxide-icons-default/src/svg'

  /**
   * Parse a viewBox attribute into numeric origin and size.
   * @param viewBoxString - The viewBox string to parse (e.g. "0 0 24 24")
   * @returns Parsed viewBox
   */
  parseViewBox(viewBoxString: string): ViewBox {
    const parts = viewBoxString.trim().split(/\s+/)
    if (parts.length !== 4) {
      throw new Error(`Invalid viewBox format: ${viewBoxString}`)
    }

    return {
      height: parseFloat(parts[3]),
      width: parseFloat(parts[2]),
      x: parseFloat(parts[0]),
      y: parseFloat(parts[1]),
    }
  }

  /**
   * Scale and translate so a source viewBox maps onto -100 -100 200 200.
   * @param sourceViewBox - The source SVG viewBox
   * @returns Uniform scale and translation
   */
  private calculateTransformation(sourceViewBox: ViewBox): {
    scale: number,
    translateX: number,
    translateY: number,
  } {
    const scale = Math.min(
      this.targetViewBox.width / sourceViewBox.width,
      this.targetViewBox.height / sourceViewBox.height,
    )
    const scaledWidth = sourceViewBox.width * scale
    const scaledHeight = sourceViewBox.height * scale
    const translateX = this.targetViewBox.x + ((this.targetViewBox.width - scaledWidth) / 2) -
      (sourceViewBox.x * scale)
    const translateY = this.targetViewBox.y + ((this.targetViewBox.height - scaledHeight) / 2) -
      (sourceViewBox.y * scale)

    return { scale, translateX, translateY }
  }

  /**
   * Convert a PascalCase name to kebab-case.
   * @param value - The identifier to convert
   * @returns kebab-case name
   */
  private kebabCase(value: string): string {
    return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  }

  /**
   * Read an attribute value from a raw HTML/SVG attribute string.
   * @param attributes - The attribute blob from an opening tag
   * @param name - The attribute name
   * @returns The attribute value, if present
   */
  private readAttribute(attributes: string, name: string): string | undefined {
    return new RegExp(`(?:^|\\s)${name}\\s*=\\s*['"]([^'"]+)['"]`, 'i').exec(attributes)?.[1]
  }

  /**
   * True when the element is a faded Sketch leftover (opacity below 1).
   * @param attributes - The attribute blob from an opening tag
   * @returns Whether the shape should be skipped
   */
  private isFaded(attributes: string): boolean {
    const opacity = this.readAttribute(attributes, 'opacity')
    return opacity !== undefined && parseFloat(opacity) < 1
  }

  /**
   * True when `inner` sits fully inside `outer`.
   * @param outer - Candidate containing box
   * @param inner - Candidate contained box
   * @returns Whether outer contains inner
   */
  private bboxContains(outer: ViewBox, inner: ViewBox): boolean {
    return outer.x <= inner.x
      && outer.y <= inner.y
      && (outer.x + outer.width) >= (inner.x + inner.width)
      && (outer.y + outer.height) >= (inner.y + inner.height)
  }

  /**
   * Transform path data onto the basis viewBox and split sibling glyphs.
   * Nested hole subpaths stay in one compound path.
   * @param pathData - Source SVG path `d`
   * @param viewBoxString - Source viewBox
   * @returns One or more transformed path strings
   */
  transformPathData(pathData: string, viewBoxString: string): string[] {
    const { scale, translateX, translateY } = this.calculateTransformation(
      this.parseViewBox(viewBoxString),
    )
    const commander = new SVGPathCommander(pathData, { round: 4 })
    commander.toAbsolute()
    commander.transform({
      scale: [scale, scale],
      translate: [translateX, translateY],
    })

    const parts = SVGPathCommander.splitPath(commander.segments)
    const boxes = parts.map(part => new SVGPathCommander(pathToString(part)).getBBox())
    const hasHole = boxes.some((outer, outerIndex) => (
      boxes.some((inner, innerIndex) => (
        outerIndex !== innerIndex
        && this.bboxContains(outer, inner)
        && (inner.width < outer.width || inner.height < outer.height)
      ))
    ))

    const glyphs = hasHole ? [commander.segments] : parts
    return glyphs
      .map(part => pathToString(roundPath(part, 4)))
      .filter(part => part.length > 0)
      .map(d => (hasHole ? d : this.slimGlyph(d)))
  }

  /**
   * Rebuild an elongated TinyMCE bar as a Menu-weight stadium, keeping length and center.
   * Compound hole glyphs are left alone.
   * @param d - Transformed path data
   * @returns Slimmed path data, or the original if the glyph is not a bar
   */
  private slimGlyph(d: string): string {
    const box = new SVGPathCommander(d).getBBox()
    const aspect = box.width / Math.max(box.height, 0.001)
    const isHorizontalBar = aspect >= 1.6 && box.height > this.targetBarThickness + 0.5
    const isVerticalBar = (1 / aspect) >= 1.6 && box.width > this.targetBarThickness + 0.5

    if (isHorizontalBar) {
      const centerY = box.y + (box.height / 2)
      return this.stadiumPath(
        box.x,
        centerY - (this.targetBarThickness / 2),
        box.width,
        this.targetBarThickness,
      )
    }

    if (isVerticalBar) {
      const centerX = box.x + (box.width / 2)
      return this.stadiumPath(
        centerX - (this.targetBarThickness / 2),
        box.y,
        this.targetBarThickness,
        box.height,
      )
    }

    return d
  }

  /**
   * Draw a fully rounded stadium matching Menu/Dash bar construction.
   * @param x - Left
   * @param y - Top
   * @param width - Width
   * @param height - Height
   * @returns Path `d`
   */
  private stadiumPath(x: number, y: number, width: number, height: number): string {
    const radius = Math.min(width, height) / 2
    const right = x + width
    const bottom = y + height
    const x1 = x + radius
    const x2 = right - radius
    const y1 = y + radius
    const y2 = bottom - radius
    const r = radius.toFixed(4)
    return [
      `M${x1.toFixed(4)} ${y.toFixed(4)}`,
      `H${x2.toFixed(4)}`,
      `A${r} ${r} 0 0 1 ${right.toFixed(4)} ${y1.toFixed(4)}`,
      `V${y2.toFixed(4)}`,
      `A${r} ${r} 0 0 1 ${x2.toFixed(4)} ${bottom.toFixed(4)}`,
      `H${x1.toFixed(4)}`,
      `A${r} ${r} 0 0 1 ${x.toFixed(4)} ${y2.toFixed(4)}`,
      `V${y1.toFixed(4)}`,
      `A${r} ${r} 0 0 1 ${x1.toFixed(4)} ${y.toFixed(4)}`,
      'Z',
    ].join('')
  }

  /**
   * Convert a rectangle to path data.
   * @param x - Left
   * @param y - Top
   * @param width - Width
   * @param height - Height
   * @returns Path `d`
   */
  private rectToPath(x: number, y: number, width: number, height: number): string {
    return `M${x} ${y}H${x + width}V${y + height}H${x}Z`
  }

  /**
   * Convert a circle to path data.
   * @param cx - Center x
   * @param cy - Center y
   * @param r - Radius
   * @returns Path `d`
   */
  private circleToPath(cx: number, cy: number, r: number): string {
    return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`
  }

  /**
   * Convert a line to path data.
   * @param x1 - Start x
   * @param y1 - Start y
   * @param x2 - End x
   * @param y2 - End y
   * @returns Path `d`
   */
  private lineToPath(x1: number, y1: number, x2: number, y2: number): string {
    return `M${x1} ${y1}L${x2} ${y2}`
  }

  /**
   * Convert polygon/polyline points to path data.
   * @param raw - The `points` attribute
   * @param close - Whether to close the shape
   * @returns Path `d`, if there are enough points
   */
  private polygonToPath(raw: string, close: boolean): string | undefined {
    const numbers = raw.trim().split(/[\s,]+/).map(Number).filter(value => !isNaN(value))
    if (numbers.length < 4) return undefined

    const [startX, startY, ...rest] = numbers
    let d = `M${startX} ${startY}`
    for (let index = 0; index < rest.length; index += 2) {
      if (rest[index + 1] === undefined) break
      d += `L${rest[index]} ${rest[index + 1]}`
    }
    if (close) d += 'Z'
    return d
  }

  /**
   * Collect drawable path data from an SVG string.
   * @param svg - Source SVG markup
   * @returns Path `d` values in document order
   */
  extractPathData(svg: string): string[] {
    const paths: string[] = []

    for (const match of svg.matchAll(/<(path|rect|circle|polygon|polyline|line)\b([^>]*?)(?:\/>|>)/gi)) {
      const tag = match[1].toLowerCase()
      const attributes = match[2]
      if (this.isFaded(attributes)) continue

      if (tag === 'path') {
        const d = this.readAttribute(attributes, 'd')
        if (d) paths.push(d)
        continue
      }

      if (tag === 'rect') {
        paths.push(this.rectToPath(
          parseFloat(this.readAttribute(attributes, 'x') ?? '0'),
          parseFloat(this.readAttribute(attributes, 'y') ?? '0'),
          parseFloat(this.readAttribute(attributes, 'width') ?? '0'),
          parseFloat(this.readAttribute(attributes, 'height') ?? '0'),
        ))
        continue
      }

      if (tag === 'circle') {
        paths.push(this.circleToPath(
          parseFloat(this.readAttribute(attributes, 'cx') ?? '0'),
          parseFloat(this.readAttribute(attributes, 'cy') ?? '0'),
          parseFloat(this.readAttribute(attributes, 'r') ?? '0'),
        ))
        continue
      }

      if (tag === 'line') {
        paths.push(this.lineToPath(
          parseFloat(this.readAttribute(attributes, 'x1') ?? '0'),
          parseFloat(this.readAttribute(attributes, 'y1') ?? '0'),
          parseFloat(this.readAttribute(attributes, 'x2') ?? '0'),
          parseFloat(this.readAttribute(attributes, 'y2') ?? '0'),
        ))
        continue
      }

      const points = this.readAttribute(attributes, 'points')
      if (!points) continue
      const d = this.polygonToPath(points, tag === 'polygon')
      if (d) paths.push(d)
    }

    return paths
  }

  /**
   * Read the viewBox from SVG markup, falling back to width/height.
   * @param svg - Source SVG markup
   * @returns viewBox string
   */
  extractViewBox(svg: string): string {
    const viewBox = /viewBox\s*=\s*['"]([^'"]+)['"]/.exec(svg)?.[1]
    if (viewBox) return viewBox

    const width = parseFloat(/width\s*=\s*['"]([^'"]+)['"]/.exec(svg)?.[1] ?? '')
    const height = parseFloat(/height\s*=\s*['"]([^'"]+)['"]/.exec(svg)?.[1] ?? '')
    if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
      return `0 0 ${width} ${height}`
    }

    throw new Error('No viewBox found in SVG')
  }

  /**
   * Render a Path JSX element.
   * @param d - Path data
   * @param name - data-name for the glyph
   * @param indent - Leading whitespace
   * @returns JSX string
   */
  private renderPathJsx(d: string, name: string, indent: string): string {
    return [
      `${indent}<Path`,
      `${indent}  d="${d}"`,
      `${indent}  data-name="${name}"`,
      `${indent}  fill={filled}`,
      `${indent}  fillRule="evenodd"`,
      `${indent}  stroke={filled ? 0 : 10}`,
      `${indent}/>`,
    ].join('\n')
  }

  /**
   * Convert an SVG document into a basis IconBase module.
   * @param svg - Source SVG markup
   * @param className - Icon class name
   * @returns TypeScript module text
   */
  svgToIconTsx(svg: string, className: string): string {
    const viewBox = this.extractViewBox(svg)
    const pathData = this.extractPathData(svg).flatMap(d => this.transformPathData(d, viewBox))
    if (pathData.length === 0) {
      throw new Error(`No path data found for ${className}`)
    }

    const baseName = this.kebabCase(className)
    const pathIndent = pathData.length === 1 ? '      ' : '        '
    const paths = pathData.map((d, index) => (
      this.renderPathJsx(d, pathData.length === 1 ? baseName : `${baseName}-${index}`, pathIndent)
    ))

    const body = paths.length === 1
      ? paths[0]
      : ['      <>', ...paths, '      </>'].join('\n')

    return [
      "import * as React from 'react'",
      "import { IconBase } from './IconBase/IconBase'",
      "import { Path } from './parts/Path'",
      '',
      `export class ${className} extends IconBase {`,
      `  static displayName = '${className}Icon'`,
      '',
      '  renderContent = (): React.ReactNode => {',
      '    const { filled } = this.props',
      '',
      '    return (',
      body,
      '    )',
      '  }',
      '}',
      '',
    ].join('\n')
  }

  /**
   * Build the icons barrel file contents.
   * @param names - Icon class names
   * @returns Barrel module text
   */
  iconsBarrel(names: string[]): string {
    return `${[...names].sort().map(name => `export * from './icons/${name}'`).join('\n')}\n`
  }

  /**
   * Fetch a TinyMCE SVG from GitHub.
   * @param fileName - SVG filename in oxide-icons-default
   * @returns SVG markup
   */
  async fetchTinyMceSvg(fileName: string): Promise<string> {
    const response = await fetch(`${this.tinyMceSvgBase}/${fileName}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${fileName}: ${response.status}`)
    }
    return response.text()
  }

  /**
   * Write transformed icon modules and refresh the icons barrel.
   * @param iconsDir - Directory for icon class files
   * @param barrelPath - Path to libraries/react/icons.ts
   * @param svgs - SVG markup keyed by class name
   * @returns Written class names
   */
  writeEditorIcons(
    iconsDir: string,
    barrelPath: string,
    svgs: Record<string, string>,
  ): string[] {
    const written = Object.keys(ICON_SOURCES).sort()
    for (const name of written) {
      const fileName = ICON_SOURCES[name as keyof typeof ICON_SOURCES]
      const svg = svgs[name]
      if (!svg) throw new Error(`Missing SVG for ${name} (${fileName})`)
      writeFileSync(join(iconsDir, `${name}.tsx`), this.svgToIconTsx(svg, name), 'utf-8')
    }

    const existing = readdirSync(iconsDir)
      .filter(file => file.endsWith('.tsx') && !file.includes('.test.'))
      .map(file => basename(file, '.tsx'))
      .sort()

    writeFileSync(barrelPath, this.iconsBarrel(existing), 'utf-8')
    return written
  }
}

const converter = new SvgToIcon()

/**
 * Parse a viewBox attribute into numeric origin and size.
 * @param viewBoxString - The viewBox string to parse
 * @returns Parsed viewBox
 */
export function parseViewBox(viewBoxString: string): ViewBox {
  return converter.parseViewBox(viewBoxString)
}

/**
 * Transform path data onto the basis viewBox and split sibling glyphs.
 * @param pathData - Source SVG path `d`
 * @param viewBoxString - Source viewBox
 * @returns One or more transformed path strings
 */
export function transformPathData(pathData: string, viewBoxString: string): string[] {
  return converter.transformPathData(pathData, viewBoxString)
}

/**
 * Convert an SVG document into a basis IconBase module.
 * @param svg - Source SVG markup
 * @param className - Icon class name
 * @returns TypeScript module text
 */
export function svgToIconTsx(svg: string, className: string): string {
  return converter.svgToIconTsx(svg, className)
}

/**
 * Build the icons barrel file contents.
 * @param names - Icon class names
 * @returns Barrel module text
 */
export function iconsBarrel(names: string[]): string {
  return converter.iconsBarrel(names)
}

/**
 * Fetch a TinyMCE SVG from GitHub.
 * @param fileName - SVG filename in oxide-icons-default
 * @returns SVG markup
 */
export async function fetchTinyMceSvg(fileName: string): Promise<string> {
  return converter.fetchTinyMceSvg(fileName)
}

/**
 * Write transformed icon modules and refresh the icons barrel.
 * @param iconsDir - Directory for icon class files
 * @param barrelPath - Path to libraries/react/icons.ts
 * @param svgs - SVG markup keyed by class name
 * @returns Written class names
 */
export function writeEditorIcons(
  iconsDir: string,
  barrelPath: string,
  svgs: Record<string, string>,
): string[] {
  return converter.writeEditorIcons(iconsDir, barrelPath, svgs)
}

if (import.meta.main) {
  const root = process.cwd()
  const iconsDir = join(root, 'libraries', 'react', 'icons')
  const barrelPath = join(root, 'libraries', 'react', 'icons.ts')
  const cacheDir = join(root, 'temp', 'tinymce-svgs')
  mkdirSync(cacheDir, { recursive: true })

  const svgs: Record<string, string> = {}
  for (const [name, fileName] of Object.entries(ICON_SOURCES)) {
    const cachePath = join(cacheDir, fileName)
    try {
      svgs[name] = readFileSync(cachePath, 'utf-8')
    } catch {
      const svg = await converter.fetchTinyMceSvg(fileName)
      writeFileSync(cachePath, svg, 'utf-8')
      svgs[name] = svg
    }
  }

  const written = converter.writeEditorIcons(iconsDir, barrelPath, svgs)
  // eslint-disable-next-line no-console
  console.log(`Wrote ${written.length} editor icons`)
}
