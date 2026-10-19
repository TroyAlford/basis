/**
 * Finds `css` tagged template literals without a TypeScript or Babel parser.
 *
 * The scanner only needs to understand enough JavaScript and TypeScript to
 * skip comments, strings, and non-CSS templates. It records the template's
 * content range and the absolute range of every `${...}` interpolation, which
 * is the shape the vendored PostCSS syntax expects.
 */

/**
 * @typedef {object} NodeData
 * @property {string} css
 * @property {number} rangeStart
 * @property {number} rangeEnd
 * @property {Array<{ start: number, end: number }>} interpolationRanges
 * @property {{ line: number, column: number }} locationStart
 */

/**
 * @param {string} value
 * @returns {boolean}
 */
const isIdentifierStart = value => /[A-Za-z_$]/.test(value)

/**
 * @param {string} value
 * @returns {boolean}
 */
const isIdentifierPart = value => /[A-Za-z0-9_$]/.test(value)

/**
 * Skip a quoted string.
 * @param {string} source
 * @param {number} start
 * @returns {number} Index after the string.
 */
const skipQuoted = (source, start) => {
  const quote = source[start]
  let index = start + 1
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === quote) return index + 1
    if (source[index] === '\n') return index
    index += 1
  }
  return index
}

/**
 * Skip a line comment.
 * @param {string} source
 * @param {number} start
 * @returns {number} Index after the comment.
 */
const skipLineComment = (source, start) => {
  const end = source.indexOf('\n', start + 2)
  return end === -1 ? source.length : end + 1
}

/**
 * Skip a block comment.
 * @param {string} source
 * @param {number} start
 * @returns {number} Index after the comment.
 */
const skipBlockComment = (source, start) => {
  const end = source.indexOf('*/', start + 2)
  return end === -1 ? source.length : end + 2
}

/**
 * Find the `}` that closes an interpolation, skipping nested expressions.
 * @param {string} source
 * @param {number} start Index after `${`.
 * @returns {number} Index after the closing brace.
 */
const findExpressionEnd = (source, start) => {
  let depth = 1
  let index = start
  while (index < source.length) {
    const value = source[index]
    if (value === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index)
      continue
    }
    if (value === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index)
      continue
    }
    if (value === "'" || value === '"') {
      index = skipQuoted(source, index)
      continue
    }
    if (value === '`') {
      index = scanTemplate(source, index).rangeEnd + 1
      continue
    }
    if (value === '{') {
      depth += 1
      index += 1
      continue
    }
    if (value === '}') {
      depth -= 1
      index += 1
      if (depth === 0) return index
      continue
    }
    index += 1
  }
  return index
}

/**
 * Scan a template literal.
 * @param {string} source
 * @param {number} start Index of the opening backtick.
 * @returns {{ rangeEnd: number, interpolationRanges: Array<{ start: number, end: number }> }}
 */
const scanTemplate = (source, start) => {
  /** @type {Array<{ start: number, end: number }>} */
  const interpolationRanges = []
  let index = start + 1
  while (index < source.length) {
    const value = source[index]
    if (value === '\\') {
      index += 2
      continue
    }
    if (value === '`') return { rangeEnd: index, interpolationRanges }
    if (value === '$' && source[index + 1] === '{') {
      const end = findExpressionEnd(source, index + 2)
      interpolationRanges.push({ start: index, end })
      index = end
      continue
    }
    index += 1
  }
  return { rangeEnd: source.length, interpolationRanges }
}

/**
 * Build a line-start table for 0-based line/column lookup.
 * @param {string} source
 * @returns {number[]}
 */
const lineStarts = source => {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1)
  }
  return starts
}

/**
 * Convert an absolute offset to a 0-based line and column.
 * @param {number[]} starts
 * @param {number} offset
 * @returns {{ line: number, column: number }}
 */
const locationOf = (starts, offset) => {
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
 * Find every `css` tagged template in a source file.
 * @param {string} source
 * @returns {NodeData[]}
 */
export const parseTemplates = source => {
  /** @type {NodeData[]} */
  const nodes = []
  const starts = lineStarts(source)
  let index = 0

  while (index < source.length) {
    const value = source[index]

    if (value === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index)
      continue
    }

    if (value === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index)
      continue
    }

    if (value === "'" || value === '"') {
      index = skipQuoted(source, index)
      continue
    }

    if (value === '`') {
      index = scanTemplate(source, index).rangeEnd + 1
      continue
    }

    if (isIdentifierStart(value)) {
      const start = index
      index += 1
      while (index < source.length && isIdentifierPart(source[index])) index += 1

      if (source.slice(start, index) !== 'css') continue

      let next = index
      while (next < source.length && /\s/.test(source[next])) next += 1
      if (source[next] !== '`') continue

      const { rangeEnd, interpolationRanges } = scanTemplate(source, next)
      const rangeStart = next + 1
      nodes.push({
        css: source.slice(rangeStart, rangeEnd),
        interpolationRanges,
        locationStart: locationOf(starts, next),
        rangeEnd,
        rangeStart,
      })
      index = rangeEnd + 1
      continue
    }

    index += 1
  }

  return nodes
}
