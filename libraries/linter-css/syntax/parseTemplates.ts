import { parseSync } from 'oxc-parser'

/** The data the PostCSS syntax needs for one `css` template. */
export interface NodeData {
  /** CSS text between the template backticks. */
  css: string,
  /** Interpolation ranges, including `${` and `}`. */
  interpolationRanges: Array<{ start: number, end: number }>,
  /** Zero-based line and column of the opening backtick. */
  locationStart: { line: number, column: number },
  /** Offset of the closing backtick. */
  rangeEnd: number,
  /** Offset of the first CSS character. */
  rangeStart: number,
}

/** The subset of an Oxc AST node this parser reads. */
interface OxcNode {
  /** Node type. */
  type: string,
  /** Start offset. */
  start: number,
  /** End offset. */
  end: number,
  /** Optional range, enabled by the parser. */
  range?: [number, number],
}

/** An Oxc template element. */
interface TemplateElement extends OxcNode {
  /** The raw template text. */
  value: { cooked: string | null, raw: string },
}

/** An Oxc template literal. */
interface TemplateLiteral extends OxcNode {
  /** Embedded expressions. */
  expressions: OxcNode[],
  /** Static template segments. */
  quasis: TemplateElement[],
}

/** An Oxc tagged template expression. */
interface TaggedTemplateExpression extends OxcNode {
  /** The tag expression. */
  quasi: TemplateLiteral,
  /** The tag identifier. */
  tag: OxcNode & { name?: string },
}

/**
 * Build a line-start table for zero-based line and column lookup.
 * @param source - The source text.
 * @returns Offset of each line start.
 */
const lineStarts = (source: string): number[] => {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1)
  }
  return starts
}

/**
 * Convert an absolute offset to a zero-based line and column.
 * @param starts - The line-start table.
 * @param offset - The absolute offset.
 * @returns The zero-based line and column.
 */
const locationOf = (starts: number[], offset: number): { line: number, column: number } => {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2)
    if (starts[middle] <= offset) low = middle
    else high = middle - 1
  }
  return { line: low, column: offset - starts[low] }
}

/**
 * Read a node's range, falling back to its start and end offsets.
 * @param node - The node to inspect.
 * @returns The node range.
 */
const rangeOf = (node: OxcNode): [number, number] => node.range ?? [node.start, node.end]

/**
 * Whether an object is an Oxc node.
 * @param value - The value to inspect.
 * @returns Whether the value looks like an AST node.
 */
const isNode = (value: unknown): value is OxcNode => (
  typeof value === 'object'
  && value !== null
  && typeof (value as { type?: unknown }).type === 'string'
  && typeof (value as { start?: unknown }).start === 'number'
)

/**
 * Whether a tagged template is a CSS template.
 * @param node - The tagged template to inspect.
 * @returns Whether the tag is `css` or `createGlobalStyle`.
 */
const isCssTag = (node: TaggedTemplateExpression): boolean => (
  node.tag.type === 'Identifier'
  && (node.tag.name === 'css' || node.tag.name === 'createGlobalStyle')
)

/**
 * Walk an AST and collect CSS template metadata.
 * @param value - The value to walk.
 * @param found - Collected templates.
 * @param seen - Nodes already visited.
 */
const walk = (value: unknown, found: NodeData[], seen: Set<unknown>, source: string, starts: number[]): void => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)

  if (isNode(value) && value.type === 'TaggedTemplateExpression') {
    const node = value as TaggedTemplateExpression
    if (isCssTag(node) && node.quasi.type === 'TemplateLiteral') {
      const [quasiStart, quasiEnd] = rangeOf(node.quasi)
      const rangeStart = quasiStart + 1
      const rangeEnd = quasiEnd - 1
      const interpolationRanges = node.quasi.expressions.map((expression, index) => {
        const [, expressionEnd] = rangeOf(expression)
        return {
          start: rangeOf(node.quasi.quasis[index])[1] - 2,
          end: expressionEnd + 1,
        }
      })
      found.push({
        css: source.slice(rangeStart, rangeEnd),
        interpolationRanges,
        locationStart: locationOf(starts, quasiStart),
        rangeEnd,
        rangeStart,
      })
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue
    if (Array.isArray(child)) child.forEach(item => walk(item, found, seen, source, starts))
    else walk(child, found, seen, source, starts)
  }
}

/**
 * Find every `css` tagged template in a source file through an AST.
 * @param source - The TypeScript source text.
 * @returns The template metadata, ordered by source offset.
 */
export const parseTemplates = (source: string): NodeData[] => {
  let program: unknown
  try {
    program = parseSync('styles.ts', source, {
      lang: 'ts',
      range: true,
      sourceType: 'module',
    }).program
  } catch {
    return []
  }

  const found: NodeData[] = []
  walk(program, found, new Set(), source, lineStarts(source))
  return found.sort((left, right) => left.rangeStart - right.rangeStart)
}
