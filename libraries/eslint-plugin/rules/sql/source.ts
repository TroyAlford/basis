import { scanSync } from 'libpg-query'

/** One source lexeme from the PostgreSQL scanner. */
export interface SqlSourceToken {
  readonly end: number,
  readonly start: number,
  readonly text: string,
  readonly tokenName: string,
}

/** One source range. */
export interface SqlSourceSpan {
  readonly end: number,
  readonly start: number,
}

/** An expression alias and its optional source column list. */
export interface SqlSourceAlias {
  readonly columns: readonly string[],
  readonly name?: string,
}

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/u
const ALIAS_STOP_WORDS = new Set([
  'cross', 'except', 'fetch', 'for', 'from', 'full', 'group', 'having', 'inner', 'intersect',
  'join', 'left', 'limit', 'natural', 'offset', 'on', 'order', 'returning', 'right', 'union',
  'using', 'values', 'where', 'window',
])

/** Source tokens used to recover exact identifier spelling from AST locations. */
export class SqlSource {
  readonly tokens: readonly SqlSourceToken[]
  private readonly lineStarts: number[] = [0]
  private readonly tokenByStart = new Map<number, number>()

  constructor(readonly sql: string) {
    this.tokens = scanSync(sql).tokens.map(token => ({
      end: token.end,
      start: token.start,
      text: token.text,
      tokenName: token.tokenName,
    }))
    this.tokens.forEach((token, index) => {
      if (!this.tokenByStart.has(token.start)) this.tokenByStart.set(token.start, index)
    })
    for (let index = 0; index < sql.length; index += 1) {
      if (sql[index] === '\n') this.lineStarts.push(index + 1)
    }
  }

  /** The exact token beginning at a source position. */
  tokenAt(position: number | undefined): SqlSourceToken | undefined {
    if (position === undefined || position < 0) return undefined
    const index = this.tokenByStart.get(position)
    return index === undefined ? undefined : this.tokens[index]
  }

  /** Exact source components of a dotted name. */
  qualifiedParts(position: number | undefined, fallback: readonly string[]): string[] {
    const token = this.tokenAt(position)
    if (token === undefined || !isName(token)) return [...fallback]
    let index = this.tokenByStart.get(token.start) as number
    const parts = [token.text]
    while (true) {
      const dot = this.tokens[index + 1]
      const next = this.tokens[index + 2]
      if (dot?.text !== '.' || next === undefined || !isName(next)) break
      parts.push(next.text)
      index += 2
    }
    return parts
  }

  /** Exact identifier at a source position. */
  identifierAt(position: number | undefined, fallback: string): string {
    return this.tokenAt(position)?.text ?? fallback
  }

  /** Nearest identifier token matching a folded name at or after a position. */
  tokenNear(position: number, name: string): SqlSourceToken | undefined {
    const target = name.toLowerCase()
    for (const token of this.tokens) {
      if (token.start < position || !isName(token)) continue
      if (unquote(token.text).toLowerCase() === target) return token
    }
    return undefined
  }

  /** Nearest identifier matching a folded name at or after a position. */
  identifierNear(position: number, name: string): string {
    return this.tokenNear(position, name)?.text ?? name
  }

  /** Nearest identifier matching a folded name at or before a position. */
  identifierBefore(position: number, name: string): string {
    const target = name.toLowerCase()
    for (let index = this.tokens.length - 1; index >= 0; index -= 1) {
      const token = this.tokens[index] as SqlSourceToken
      if (token.end > position || !isName(token)) continue
      if (unquote(token.text).toLowerCase() === target) return token.text
    }
    return name
  }

  /** Exact alias following a range variable. */
  relationAlias(position: number | undefined): string | undefined {
    const token = this.tokenAt(position)
    if (token === undefined) return undefined
    let index = this.tokenByStart.get(token.start) as number
    while (true) {
      const dot = this.tokens[index + 1]
      const next = this.tokens[index + 2]
      if (dot?.text !== '.' || next === undefined || !isName(next)) break
      index += 2
    }
    let alias = this.tokens[index + 1]
    if (alias?.text.toLowerCase() === 'as') alias = this.tokens[index + 2]
    return alias && isName(alias) && !ALIAS_STOP_WORDS.has(unquote(alias.text).toLowerCase())
      ? alias.text
      : undefined
  }

  /** Exact alias following an explicit top-level AS. */
  explicitAliasAfter(position: number): string | undefined {
    let depth = 0
    for (let index = 0; index < this.tokens.length; index += 1) {
      const token = this.tokens[index] as SqlSourceToken
      if (token.end <= position) continue
      if (token.text === '(' || token.text === '[') depth += 1
      else if (token.text === ')' || token.text === ']') depth = Math.max(0, depth - 1)
      else if (depth === 0 && token.text.toLowerCase() === 'as') {
        const next = this.tokens[index + 1]
        return next && isName(next) ? next.text : undefined
      }
    }
    return undefined
  }

  /** Exact alias and column aliases following an expression. */
  aliasAfterExpression(position: number): SqlSourceAlias {
    let index = this.tokens.findIndex(token => token.end > position)
    if (index < 0) return { columns: [] }
    while (index < this.tokens.length && (this.tokens[index] as SqlSourceToken).text !== ')') index += 1
    if (index >= this.tokens.length) return { columns: [] }
    while (index < this.tokens.length && (this.tokens[index] as SqlSourceToken).text === ')') index += 1
    if (this.tokens[index]?.text.toLowerCase() === 'as') index += 1
    const nameToken = this.tokens[index]
    if (nameToken === undefined || !isName(nameToken)) return { columns: [] }
    const name = nameToken.text
    if (ALIAS_STOP_WORDS.has(unquote(name).toLowerCase())) return { columns: [] }
    index += 1
    const columns: string[] = []
    if (this.tokens[index]?.text === '(') {
      index += 1
      while (index < this.tokens.length) {
        const token = this.tokens[index] as SqlSourceToken
        if (token.text === ')') break
        if (isName(token)) columns.push(token.text)
        index += 1
      }
    }
    return { columns, name }
  }

  /** Source span covered by a node and its descendants. */
  span(node: unknown): SqlSourceSpan | null {
    let start = Number.POSITIVE_INFINITY
    let end = Number.NEGATIVE_INFINITY
    const seen = new Set<object>()
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object' || seen.has(value)) return
      seen.add(value)
      if (Array.isArray(value)) {
        for (const child of value) visit(child)
        return
      }
      const location = (value as { location?: unknown }).location
      if (typeof location === 'number' && location >= 0) {
        const token = this.tokenAt(location)
        if (token) {
          start = Math.min(start, token.start)
          end = Math.max(end, token.end)
        }
      }
      for (const child of Object.values(value)) visit(child)
    }
    visit(node)
    return start === Number.POSITIVE_INFINITY ? null : { end, start }
  }

  /** The 1-based line for a position. */
  lineAt(position: number): number {
    let low = 0
    let high = this.lineStarts.length - 1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if ((this.lineStarts[middle] as number) <= position) low = middle + 1
      else high = middle - 1
    }
    return high + 1
  }
}

/** Remove surrounding double quotes from an identifier token. */
export function unquote(text: string): string {
  return text.startsWith('"') && text.endsWith('"')
    ? text.slice(1, -1).replace(/""/gu, '"')
    : text
}

/** Whether a token is a plausible identifier component. */
function isName(token: SqlSourceToken): boolean {
  return token.tokenName === 'IDENT' || NAME_PATTERN.test(token.text)
}
