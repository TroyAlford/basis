/** A full SQL assertion accepted by {@link toMatchSQL}. */
export type SQLGolden = string | readonly string[]

declare module 'bun:test' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- declaration merging requires the generic slot.
  interface Matchers<T> {
    /**
     * Assert one complete SQL statement or an ordered array of statements.
     * @param expected - Full expected SQL or ordered statement list.
     */
    toMatchSQL(expected: SQLGolden): void,
  }

  interface AsymmetricMatchers {
    /**
     * Assert one complete SQL statement or an ordered array of statements.
     * @param expected - Full expected SQL or ordered statement list.
     */
    toMatchSQL(expected: SQLGolden): void,
  }
}

/**
 * Assert one complete SQL statement or ordered statement list.
 *
 * Only insignificant formatting whitespace is normalized. Quotes, punctuation,
 * keywords, operators, placeholders, and statement order remain significant.
 * @param this - Matcher context.
 * @param actual - Actual SQL or statement list.
 * @param expected - Expected SQL or statement list.
 * @returns Whether the SQL matched, with a readable failure message.
 */
export function toMatchSQL(
  this: unknown,
  actual: unknown,
  expected: SQLGolden,
): { message: () => string, pass: boolean } {
  const actualStatements = statements(actual)
  const expectedStatements = statements(expected)
  const normalizedActual = actualStatements.map(normalizeSQL)
  const normalizedExpected = expectedStatements.map(normalizeSQL)
  const pass = normalizedActual.length === normalizedExpected.length
    && normalizedActual.every((statement, index) => statement === normalizedExpected[index])

  return {
    message: () => [
      'Expected SQL:',
      format(normalizedExpected),
      'Received SQL:',
      format(normalizedActual),
    ].join('\n'),
    pass,
  }
}

/**
 * Normalize insignificant formatting whitespace outside quoted text.
 * @param sql - SQL source.
 * @returns Whitespace-normalized SQL.
 */
export function normalizeSQL(sql: string): string {
  let normalized = ''
  let pendingSpace = false
  let quote: '"' | "'" | null = null

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index] as string
    if (quote) {
      normalized += character
      if (character === quote) {
        if (sql[index + 1] === quote) {
          normalized += sql[index + 1]
          index += 1
        } else {
          quote = null
        }
      }
      continue
    }

    if (character === '"' || character === "'") {
      normalized += separator(normalized, pendingSpace, character)
      pendingSpace = false
      quote = character
      normalized += character
      continue
    }

    if (character === '-' && sql[index + 1] === '-') {
      normalized += separator(normalized, pendingSpace, character)
      pendingSpace = false
      const end = sql.indexOf('\n', index)
      if (end === -1) {
        normalized += sql.slice(index)
        break
      }
      normalized += `${sql.slice(index, end)}\n`
      index = end
      continue
    }

    if (character === '/' && sql[index + 1] === '*') {
      normalized += separator(normalized, pendingSpace, character)
      pendingSpace = false
      const end = sql.indexOf('*/', index + 2)
      if (end === -1) {
        normalized += sql.slice(index)
        break
      }
      normalized += sql.slice(index, end + 2)
      index = end + 1
      continue
    }

    const tag = dollarQuoteTag(sql, index)
    if (tag) {
      normalized += separator(normalized, pendingSpace, character)
      pendingSpace = false
      const end = sql.indexOf(tag, index + tag.length)
      if (end === -1) {
        normalized += sql.slice(index)
        break
      }
      normalized += sql.slice(index, end + tag.length)
      index = end + tag.length - 1
      continue
    }

    if (/\s/.test(character)) {
      pendingSpace = normalized.length > 0
      continue
    }

    normalized += separator(normalized, pendingSpace, character)
    pendingSpace = false
    normalized += character
  }

  return normalized.trim()
}

/**
 * Return one insignificant separator when formatting whitespace is removable.
 * @param current - SQL accumulated so far.
 * @param pending - Whether source whitespace is pending.
 * @param next - Next significant character.
 * @returns A single space or an empty string.
 */
function separator(current: string, pending: boolean, next: string): string {
  const previous = current.at(-1)
  if (!pending || previous === undefined) return ''
  if (previous === '(' || previous === ',' || next === ')' || next === ',') return ''
  return ' '
}

/**
 * Detect a PostgreSQL dollar-quote opening tag.
 * @param sql - SQL source.
 * @param index - Candidate `$` offset.
 * @returns The opening tag, or null when this is not a dollar quote.
 */
function dollarQuoteTag(sql: string, index: number): string | null {
  if (sql[index] !== '$') return null
  return /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(index))?.[0] ?? null
}

/**
 * Convert an actual or expected value into an SQL statement list.
 * @param value - SQL value.
 * @returns The statement list.
 * @throws {Error} When the value is not SQL text or a list of SQL text.
 */
function statements(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value) && value.every(entry => typeof entry === 'string')) return value
  throw new Error('toMatchSQL expects a string or an array of strings')
}

/**
 * Format normalized statements for a failure message.
 * @param values - Normalized statements.
 * @returns Readable statement list.
 */
function format(values: readonly string[]): string {
  return values.map((statement, index) => (
    values.length === 1 ? statement : `-- statement ${index + 1} --\n${statement}`
  )).join('\n')
}
