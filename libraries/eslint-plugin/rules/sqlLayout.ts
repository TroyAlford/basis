/** A composable document used to lay out formatted SQL. */
export type SqlDoc =
  | { type: 'text', value: string }
  | { hard: boolean, type: 'line' }
  | { parts: readonly SqlDoc[], type: 'concat' }
  | { doc: SqlDoc, type: 'indent' }
  | { doc: SqlDoc, type: 'group' }

/**
 * Create text.
 * @param value - Literal text.
 * @returns Text document.
 */
export function text(value: string): SqlDoc {
  return { type: 'text', value }
}

/**
 * Create a line that flattens to a space inside a group.
 * @returns Line document.
 */
export function line(): SqlDoc {
  return { hard: false, type: 'line' }
}

/**
 * Create a line that always breaks.
 * @returns Line document.
 */
export function hardline(): SqlDoc {
  return { hard: true, type: 'line' }
}

/**
 * Concatenate documents in order.
 * @param parts - Documents.
 * @returns Concatenated document.
 */
export function concat(...parts: readonly SqlDoc[]): SqlDoc {
  return { parts, type: 'concat' }
}

/**
 * Add one indentation level to nested line breaks.
 * @param doc - Document.
 * @returns Indented document.
 */
export function nest(doc: SqlDoc): SqlDoc {
  return { doc, type: 'indent' }
}

/**
 * Group a document so its soft lines flatten when they fit.
 * @param doc - Document.
 * @returns Grouped document.
 */
export function group(doc: SqlDoc): SqlDoc {
  return { doc, type: 'group' }
}

/**
 * Join documents with a separator.
 * @param separator - Separator document.
 * @param docs - Documents.
 * @returns Joined document.
 */
export function join(separator: SqlDoc, docs: readonly SqlDoc[]): SqlDoc {
  const parts: SqlDoc[] = []
  docs.forEach((doc, index) => {
    if (index > 0) parts.push(separator)
    parts.push(doc)
  })
  return concat(...parts)
}

/**
 * Check whether a document fits on the remaining line.
 * @param doc - Document.
 * @param remaining - Remaining columns.
 * @returns Whether it fits.
 */
function fits(doc: SqlDoc, remaining: number): boolean {
  if (remaining < 0) return false
  switch (doc.type) {
    case 'text': return doc.value.length <= remaining
    case 'line': return !doc.hard && remaining >= 1
    case 'concat': {
      let left = remaining
      for (const part of doc.parts) {
        if (!fits(part, left)) return false
        left -= width(part)
      }
      return true
    }
    case 'indent': return fits(doc.doc, remaining - 2)
    case 'group': return fits(doc.doc, remaining)
    default: return false
  }
}

/**
 * Measure the flat width of a document.
 * @param doc - Document.
 * @returns Flat width.
 */
function width(doc: SqlDoc): number {
  switch (doc.type) {
    case 'text': return doc.value.length
    case 'line': return doc.hard ? Number.POSITIVE_INFINITY : 1
    case 'concat': return doc.parts.reduce((total, part) => total + width(part), 0)
    case 'indent': return width(doc.doc)
    case 'group': return width(doc.doc)
    default: return 0
  }
}

/**
 * Render a document.
 * @param doc - Document.
 * @param limit - Preferred line width.
 * @returns Rendered text.
 */
export function render(doc: SqlDoc, limit = 100): string {
  const output: string[] = []
  let column = 0
  let level = 0

  const newline = (): void => {
    output.push('\n', '  '.repeat(level))
    column = level * 2
  }

  const visit = (current: SqlDoc, flat: boolean): void => {
    switch (current.type) {
      case 'text':
        output.push(current.value)
        column += current.value.length
        break
      case 'line':
        if (current.hard || !flat) newline()
        else {
          output.push(' ')
          column += 1
        }
        break
      case 'concat':
        for (const part of current.parts) visit(part, flat)
        break
      case 'indent':
        level += 1
        visit(current.doc, flat)
        level -= 1
        break
      case 'group':
        visit(current.doc, !current.doc.type || fits(current.doc, limit - column))
        break
    }
  }

  visit(doc, false)
  return output.join('')
}
