/* eslint-disable camelcase */
/** A composable document used to lay out formatted SQL. */
export type SqlDoc =
  | { kind: 'text', value: string }
  | { flat: string, hard: boolean, kind: 'line' }
  | { children: readonly SqlDoc[], kind: 'concat' }
  | { child: SqlDoc, kind: 'indent' }
  | { child: SqlDoc, kind: 'group' }

/**
 * Create literal text.
 * @param value
 */
export function text(value: string): SqlDoc {
  return { kind: 'text', value }
}

/** Create a soft line that flattens to a space inside a fitting group. */
export function line(): SqlDoc {
  return { flat: ' ', hard: false, kind: 'line' }
}

/** Create a soft line that flattens to nothing inside a fitting group. */
export function softline(): SqlDoc {
  return { flat: '', hard: false, kind: 'line' }
}

/** Create a line that always breaks. */
export function hardline(): SqlDoc {
  return { flat: '', hard: true, kind: 'line' }
}

/**
 * Concatenate documents in order.
 * @param children
 */
export function concat(...children: readonly SqlDoc[]): SqlDoc {
  return { children, kind: 'concat' }
}

/**
 * Increase indentation for nested line breaks.
 * @param child
 */
export function indent(child: SqlDoc): SqlDoc {
  return { child, kind: 'indent' }
}

/**
 * Group a document so its soft lines flatten when they fit.
 * @param child
 */
export function group(child: SqlDoc): SqlDoc {
  return { child, kind: 'group' }
}

/**
 * Join documents with a separator.
 * @param separator
 * @param docs
 */
export function join(separator: SqlDoc, docs: readonly SqlDoc[]): SqlDoc {
  const children: SqlDoc[] = []
  docs.forEach((doc, index) => {
    if (index > 0) children.push(separator)
    children.push(doc)
  })
  return concat(...children)
}

/**
 * Render a document to text.
 * @param doc
 * @param width
 */
export function render(doc: SqlDoc, width = 100): string {
  const output: string[] = []
  let column = 0
  const stack: { doc: SqlDoc, flat: boolean, level: number }[] = [{ doc, flat: false, level: 0 }]

  while (stack.length > 0) {
    const current = stack.pop() as { doc: SqlDoc, flat: boolean, level: number }
    switch (current.doc.kind) {
      case 'text':
        output.push(current.doc.value)
        column += current.doc.value.length
        break
      case 'line':
        if (current.doc.hard || !current.flat) {
          output.push('\n', '  '.repeat(current.level))
          column = current.level * 2
        } else {
          output.push(current.doc.flat)
          column += current.doc.flat.length
        }
        break
      case 'concat':
        for (let index = current.doc.children.length - 1; index >= 0; index -= 1) {
          stack.push({ doc: current.doc.children[index] as SqlDoc, flat: current.flat, level: current.level })
        }
        break
      case 'indent':
        stack.push({ doc: current.doc.child, flat: current.flat, level: current.level + 1 })
        break
      case 'group': {
        const flat = fits(width - column, [{ doc: current.doc.child, flat: true, level: current.level }])
        stack.push({ doc: current.doc.child, flat, level: current.level })
        break
      }
    }
  }

  return output.join('').split('\n').map(renderedLine => renderedLine.replace(/[ \t]+$/u, '')).join('\n')
}

/**
 * Check whether a document fits on the remaining line when flattened.
 * @param remaining
 * @param initial
 */
function fits(remaining: number, initial: readonly { doc: SqlDoc, flat: boolean, level: number }[]): boolean {
  const stack = [...initial]
  let left = remaining
  while (stack.length > 0) {
    if (left < 0) return false
    const current = stack.pop() as { doc: SqlDoc, flat: boolean, level: number }
    switch (current.doc.kind) {
      case 'text':
        left -= current.doc.value.length
        break
      case 'line':
        if (current.doc.hard) return false
        left -= current.doc.flat.length
        break
      case 'concat':
        for (let index = current.doc.children.length - 1; index >= 0; index -= 1) {
          stack.push({ doc: current.doc.children[index] as SqlDoc, flat: true, level: current.level })
        }
        break
      case 'indent':
        stack.push({ doc: current.doc.child, flat: true, level: current.level + 1 })
        break
      case 'group':
        stack.push({ doc: current.doc.child, flat: true, level: current.level })
        break
    }
  }
  return left >= 0
}
