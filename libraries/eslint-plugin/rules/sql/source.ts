/* eslint-disable camelcase */
import { scanSync } from 'libpg-query'
import { quoteSourceIdentifier } from './expressions'

/** One source token returned by the PostgreSQL scanner. */
export interface SourceToken {
  end: number,
  start: number,
  text: string,
  tokenName: string,
}

/** One SQL comment with its source position. */
export interface SqlComment {
  end: number,
  line: number,
  start: number,
  text: string,
}

/** A source range. */
export interface SourceSpan {
  end: number,
  start: number,
}

/** An alias with its optional source column list. */
export interface SourceAlias {
  columns: string[],
  name?: string,
}

const COMMENT_TOKENS = new Set(['C_COMMENT', 'SQL_COMMENT'])
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/u

/**
 * Source text plus the parser's own token boundaries.
 *
 * The PostgreSQL AST records a start `location` for meaningful atoms but not
 * their spelling or end. The scanner supplies the exact lexeme at that known
 * location, so quoted identifiers, escaped strings, dollar quotes, and numeric
 * spellings survive formatting without guessing offsets.
 */
export class SourceText {
  readonly comments: readonly SqlComment[]
  readonly tokens: readonly SourceToken[]
  private readonly byStart = new Map<number, number>()
  private readonly lineStarts: number[] = [0]
  private readonly usedComments = new Set<number>()

  constructor(readonly sql: string) {
    this.tokens = scanSync(sql).tokens.map(token => ({
      end: token.end,
      start: token.start,
      text: token.text,
      tokenName: token.tokenName,
    }))
    this.tokens.forEach((token, index) => {
      if (!this.byStart.has(token.start)) this.byStart.set(token.start, index)
    })
    for (let index = 0; index < sql.length; index += 1) {
      if (sql[index] === '\n') this.lineStarts.push(index + 1)
    }
    this.comments = this.tokens
      .filter(token => COMMENT_TOKENS.has(token.tokenName))
      .map(token => ({
        end: token.end,
        line: this.lineAt(token.start),
        start: token.start,
        text: token.text,
      }))
  }

  /**
   * Find the token beginning exactly at a source position.
   * @param position
   */
  tokenAt(position: number | undefined): SourceToken | undefined {
    if (position === undefined || position < 0) return undefined
    const index = this.byStart.get(position)
    return index === undefined ? undefined : this.tokens[index]
  }

  /**
   * Return the exact source lexeme at a location, or a fallback spelling.
   * @param position
   * @param fallback
   */
  atom(position: number | undefined, fallback: string): string {
    return this.tokenAt(position)?.text ?? fallback
  }

  /**
   * Return the exact dotted name beginning at a location.
   *
   * Only identifier components separated by dots are consumed, so a following
   * table alias or clause keyword is never swallowed.
   * @param position
   * @param fallback
   */
  qualified(position: number | undefined, fallback: string): string {
    const token = this.tokenAt(position)
    if (token === undefined) return fallback
    let index = this.byStart.get(token.start) as number
    const parts = [token.text]
    while (true) {
      const dot = this.tokens[index + 1]
      const next = this.tokens[index + 2]
      if (dot?.text !== '.' || next === undefined || !isNameToken(next)) break
      parts.push(next.text)
      index += 2
    }
    return parts.join('.')
  }

  /** Return the exact dotted source components beginning at a location. */
  qualifiedParts(position: number | undefined, fallback: readonly string[]): string[] {
    const token = this.tokenAt(position)
    if (token === undefined) return [...fallback]
    let index = this.byStart.get(token.start) as number
    const parts = [token.text]
    while (true) {
      const dot = this.tokens[index + 1]
      const next = this.tokens[index + 2]
      if (dot?.text !== '.' || next === undefined || !isNameToken(next)) break
      parts.push(next.text)
      index += 2
    }
    return parts
  }

  /** Return a quoted dotted name from exact source components. */
  quotedQualified(position: number | undefined, fallback: readonly string[]): string {
    return this.qualifiedParts(position, fallback).map(quoteSourceIdentifier).join('.')
  }

  /** Return the exact identifier token at a location. */
  identifierAt(position: number | undefined, fallback: string): string {
    return this.tokenAt(position)?.text ?? fallback
  }

  /** Quote the exact identifier at a location. */
  quotedIdentifierAt(position: number | undefined, fallback: string): string {
    return quoteSourceIdentifier(this.identifierAt(position, fallback))
  }

  /** The nearest identifier matching a folded name at or after a position. */
  identifierNear(position: number, name: string): string {
    const target = name.toLowerCase()
    for (const token of this.tokens) {
      if (token.start < position) continue
      if (!isNameToken(token)) continue
      if (unquote(token.text).toLowerCase() === target) return token.text
    }
    return name
  }

  /** Quote the nearest identifier matching a folded name at or after a position. */
  quotedIdentifierNear(position: number, name: string): string {
    return quoteSourceIdentifier(this.identifierNear(position, name))
  }

  /** The nearest identifier matching a folded name at or before a position. */
  identifierBefore(position: number, name: string): string {
    const target = name.toLowerCase()
    for (let index = this.tokens.length - 1; index >= 0; index -= 1) {
      const token = this.tokens[index] as SourceToken
      if (token.end > position) continue
      if (!isNameToken(token)) continue
      if (unquote(token.text).toLowerCase() === target) return token.text
    }
    return name
  }

  /** Quote the nearest identifier matching a folded name at or before a position. */
  quotedIdentifierBefore(position: number, name: string): string {
    return quoteSourceIdentifier(this.identifierBefore(position, name))
  }

  /** Return the exact alias token following a range-variable name. */
  relationAlias(position: number | undefined): string | undefined {
    const token = this.tokenAt(position)
    if (token === undefined) return undefined
    let index = this.byStart.get(token.start) as number
    while (true) {
      const dot = this.tokens[index + 1]
      const next = this.tokens[index + 2]
      if (dot?.text !== '.' || next === undefined || !isNameToken(next)) break
      index += 2
    }
    let alias = this.tokens[index + 1]
    if (alias?.text.toLowerCase() === 'as') alias = this.tokens[index + 2]
    return alias && isNameToken(alias) ? alias.text : undefined
  }

  /** Return a source alias and column list following an expression. */
  aliasAfterExpression(position: number): SourceAlias {
    let index = this.tokens.findIndex(token => token.end > position)
    if (index < 0) return { columns: [] }
    while (index < this.tokens.length) {
      if ((this.tokens[index] as SourceToken).text === ')') break
      index += 1
    }
    if (index >= this.tokens.length) return { columns: [] }
    while (index < this.tokens.length && (this.tokens[index] as SourceToken).text === ')') index += 1
    while (index < this.tokens.length) {
      const token = this.tokens[index] as SourceToken
      const word = unquote(token.text).toLowerCase()
      if (token.text.startsWith('"') || (word !== 'with' && word !== 'ordinality')) break
      index += 1
    }
    if (this.tokens[index]?.text.toLowerCase() === 'as') index += 1
    const nameToken = this.tokens[index]
    if (nameToken === undefined || !isNameToken(nameToken)) return { columns: [] }
    const name = nameToken.text
    if (ALIAS_STOP_WORDS.has(unquote(name).toLowerCase())) return { columns: [] }
    index += 1
    const columns: string[] = []
    if (this.tokens[index]?.text === '(') {
      index += 1
      while (index < this.tokens.length) {
        const token = this.tokens[index] as SourceToken
        if (token.text === ')') break
        if (isNameToken(token) && !ALIAS_STOP_WORDS.has(unquote(token.text).toLowerCase())) {
          columns.push(token.text)
        }
        index += 1
      }
    }
    return { columns, name }
  }

  /** Return the token after an explicit top-level AS, if one exists. */
  explicitAliasAfter(position: number): string | undefined {
    let depth = 0
    for (let index = 0; index < this.tokens.length; index += 1) {
      const token = this.tokens[index] as SourceToken
      if (token.end <= position) continue
      if (token.text === '(' || token.text === '[') depth += 1
      else if (token.text === ')' || token.text === ']') depth = Math.max(0, depth - 1)
      else if (depth === 0 && token.text.toLowerCase() === 'as') {
        const next = this.tokens[index + 1]
        return next && isNameToken(next) ? next.text : undefined
      }
    }
    return undefined
  }

  /** Return the exact alias token after a target value position. */
  aliasAfter(position: number): string | undefined {
    let depth = 0
    let candidate: string | undefined
    for (let index = 0; index < this.tokens.length; index += 1) {
      const token = this.tokens[index] as SourceToken
      if (token.end <= position) continue
      if (token.text === '(' || token.text === '[') {
        depth += 1
        continue
      }
      if (token.text === ')' || token.text === ']') {
        depth = Math.max(0, depth - 1)
        continue
      }
      if (depth !== 0) continue
      if (token.text === ',') break
      if (ALIAS_STOP_WORDS.has(token.text.toLowerCase())) break
      if (token.text.toLowerCase() === 'as') {
        const next = this.tokens[index + 1]
        return next && isNameToken(next) ? next.text : undefined
      }
      if (isNameToken(token)) candidate = token.text
    }
    return candidate
  }

  /**
   * The 1-based source line for a position.
   * @param position
   */
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

  /**
   * Compute the source span covered by a node and its descendants.
   * @param node
   */
  span(node: unknown): SourceSpan | null {
    let start = Number.POSITIVE_INFINITY
    let end = Number.NEGATIVE_INFINITY
    const seen = new Set<object>()
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      if (seen.has(value)) return
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

  /**
   * Take unused comments whose start lies in a half-open range.
   * @param start
   * @param end
   */
  takeComments(start: number, end: number): SqlComment[] {
    const taken: SqlComment[] = []
    for (const comment of this.comments) {
      if (comment.start < start || comment.start >= end) continue
      if (this.usedComments.has(comment.start)) continue
      this.usedComments.add(comment.start)
      taken.push(comment)
    }
    return taken
  }

  /**
   * Take unused comments that occur on one source line within a range.
   * @param line
   * @param start
   * @param end
   */
  takeInlineComments(line: number, start: number, end: number): SqlComment[] {
    const taken: SqlComment[] = []
    for (const comment of this.comments) {
      if (comment.start < start || comment.start >= end) continue
      if (comment.line !== line || this.usedComments.has(comment.start)) continue
      this.usedComments.add(comment.start)
      taken.push(comment)
    }
    return taken
  }

  /** Take every unused comment. */
  takeRemainingComments(): SqlComment[] {
    return this.takeComments(0, this.sql.length)
  }

  /** Whether every comment has been attached exactly once. */
  get commentsRemaining(): number {
    return this.comments.length - this.usedComments.size
  }
}

/** Keywords that end a target list element. */
const ALIAS_STOP_WORDS = new Set([
  'from', 'where', 'group', 'having', 'order', 'limit', 'offset', 'returning', 'union', 'intersect',
  'except', 'window', 'fetch', 'for',
])

/** Remove double quotes from an identifier token. */
function unquote(text: string): string {
  return text.startsWith('"') && text.endsWith('"')
    ? text.slice(1, -1).replace(/""/gu, '"')
    : text
}

/**
 * Whether a token can be an identifier component.
 * @param token
 */
function isNameToken(token: SourceToken): boolean {
  return token.tokenName === 'IDENT' || NAME_PATTERN.test(token.text)
}
