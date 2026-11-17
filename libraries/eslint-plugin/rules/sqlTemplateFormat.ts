/* eslint-disable @typescript-eslint/no-explicit-any -- AST printer boundary over PostgreSQL nodes. */
import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { loadModule, parsePlPgSQLSync, parseSync, scanSync } from 'libpg-query'

await loadModule()

/**
 * Check whether a tag expression is a recognized SQL tag.
 * @param tag - Tag expression.
 * @returns Whether the tag is `sql` or a database SQL member.
 */
function isSqlTag(tag: ESTree.Expression): boolean {
  const generic = tag as unknown as { expression?: ESTree.Expression, type: string }
  if (generic.type === 'TSInstantiationExpression' && generic.expression) {
    return isSqlTag(generic.expression)
  }
  if (tag.type === 'Identifier') return tag.name === 'sql'
  if (tag.type !== 'MemberExpression' || tag.computed || tag.property.type !== 'Identifier') return false
  if (tag.property.name !== 'sql') return false
  if (tag.object.type === 'Identifier') return tag.object.name === 'db' || tag.object.name === 'database'
  if (tag.object.type !== 'MemberExpression' || tag.object.computed) return false
  return tag.object.property.type === 'Identifier' && tag.object.property.name === 'db'
}

/**
 * Collect SQL comments with their source locations.
 * @param sql - SQL text.
 * @returns Comments in source order.
 */
function sqlComments(sql: string): SqlComment[] {
  if (!/--|\/\*/u.test(sql)) return []
  return scanSync(sql).tokens
    .filter(token => token.tokenName === 'SQL_COMMENT' || token.tokenName === 'C_COMMENT')
    .map(token => ({
      end: token.end,
      line: sql.slice(0, token.start).split('\n').length,
      start: token.start,
      text: token.text,
    }))
}

/**
 * Break formatted SQL lines at safe whitespace boundaries.
 * @param sql - Formatted SQL.
 * @returns SQL with lines no longer than 120 characters where possible.
 */
function wrapLongLines(sql: string): string {
  return sql.split('\n').flatMap(line => {
    if (line.length <= 120 || line.includes('--') || line.includes('/*')) return [line]
    const indent = line.match(/^\s*/u)?.[0] ?? ''
    const lines: string[] = []
    let current = line
    while (current.length > 120) {
      let quote: string | null = null
      let split = -1
      const limit = Math.min(current.length, 120)
      for (let index = 0; index < limit; index += 1) {
        const character = current[index] ?? ''
        if (quote) {
          if (character === quote && current[index + 1] === quote) {
            index += 1
          } else if (character === quote) {
            quote = null
          }
        } else if (character === "'" || character === '"') {
          quote = character
        } else if (character === ' ') {
          split = index
        }
      }
      if (split <= indent.length) split = current.indexOf(' ', 120)
      if (split <= 0) break
      lines.push(current.slice(0, split))
      current = `${indent}  ${current.slice(split + 1)}`
    }
    lines.push(current)
    return lines
  }).join('\n')
}

/**
 * Format one SQL template body through the PostgreSQL AST.
 * @param sql - SQL text with expression placeholders.
 * @param indent - Prefix for every formatted line.
 * @param quoteIdentifiers - Whether emitted identifiers should be quoted.
 * @returns Formatted SQL text.
 */
export function formatSQL(sql: string, indent = '', quoteIdentifiers = true): string {
  const placeholders = new Map<string, string>()
  let safeSql = ''
  for (let index = 0; index < sql.length;) {
    if (sql[index] === '\u0001') {
      const close = sql.indexOf('\u0001', index + 1)
      const digits = sql.slice(index + 1, close)
      if (close !== -1 && /^\d+$/u.test(digits)) {
        let end = close + 1
        while (sql[end] === '\u0002') end += 1
        const original = sql.slice(index, end)
        const safe = `__basis_p${digits}_${'_'.repeat(end - close - 1)}__`
        placeholders.set(safe, original)
        safeSql += safe
        index = end
        continue
      }
    }
    safeSql += sql[index]
    index += 1
  }
  try {
    const parsed = parseSync(safeSql) as any
    if (!parsed.stmts?.length) return ''
    const comments = sqlComments(safeSql)
    let formatted = parsed.stmts.map((raw: any) => {
      const start = raw.stmt_location ?? 0
      const end = raw.stmt_len === undefined ? safeSql.length : start + raw.stmt_len
      return new LibpgPrinter(safeSql, end, comments, start, quoteIdentifiers).statement(raw.stmt, indent)
    }).join(';\n\n')
    formatted = wrapLongLines(formatted)
    for (const [safe, original] of placeholders) {
      formatted = formatted.replace(new RegExp(safe, 'giu'), original)
    }
    return formatted
  } catch {
    const lines = sql.split('\n')
    while (lines.length > 0 && (lines[0] as string).trim() === '') lines.shift()
    while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') lines.pop()
    return lines.map(line => `${indent}${line}`).join('\n')
  }
}

/** One SQL comment with its absolute location. */
interface SqlComment {
  end: number,
  line: number,
  start: number,
  text: string,
}

const ALIAS_STOP_WORDS = new Set([
  'from', 'where', 'group', 'having', 'order', 'limit', 'offset', 'union', 'intersect',
  'except', 'join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'on', 'using',
  'returning', 'set', 'values', 'conflict', 'do', 'for', 'window', 'fetch', 'into', 'select',
  'update', 'delete', 'insert', 'with',
])

/** Prints raw libpg-query statements in the canonical Basis layout. */
class LibpgPrinter {
  #usedComments = new Set<number>()

  constructor(
    private readonly source: string,
    private readonly end: number,
    private readonly comments: readonly SqlComment[] = [],
    private readonly start = 0,
    private readonly quoteIdentifiers = true,
  ) {}

  /**
   * Print one statement.
   * @param node - Raw statement node.
   * @param indent - Prefix for every line.
   * @returns Formatted SQL.
   */
  statement(node: any, indent: string): string {
    return this.lines(node, '')
      .flatMap(line => line.split('\n'))
      .map(line => `${indent}${line}`)
      .join('\n')
  }

  /**
   * Return the tag and body of a raw PostgreSQL node.
   * @param node - Candidate node.
   * @returns Tag and body, or null for a plain object.
   */
  tag(node: any): [string, any] | null {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null
    const keys = Object.keys(node).filter(key => (
      key !== 'location'
      && /^[A-Z]/u.test(key)
      && node[key]
      && typeof node[key] === 'object'
      && !Array.isArray(node[key])
    ))
    return keys.length === 1 ? [keys[0] as string, node[keys[0] as string]] : null
  }

  /**
   * Read a node's byte location.
   * @param node - Candidate node.
   * @returns Location, or -1.
   */
  location(node: any): number {
    const tagged = this.tag(node)
    return typeof tagged?.[1]?.location === 'number' ? tagged[1].location : -1
  }

  /**
   * Find the first source position in a node.
   * @param node - Candidate node.
   * @returns Location, or -1.
   */
  startLocation(node: any): number {
    if (!node) return -1
    if (Array.isArray(node)) return this.startLocation(node[0])
    const tagged = this.tag(node)
    if (!tagged) return -1
    const [type, body] = tagged
    if (typeof body.location === 'number' && body.location >= 0) return body.location
    switch (type) {
      case 'JoinExpr': return this.startLocation(body.larg)
      case 'SortBy': return this.startLocation(body.node)
      case 'TypeCast': return this.startLocation(body.arg)
      case 'A_Expr': return this.startLocation(body.lexpr)
      case 'BoolExpr': return this.startLocation(body.args?.[0])
      case 'NullTest': return this.startLocation(body.arg)
      case 'BooleanTest': return this.startLocation(body.arg)
      default: return -1
    }
  }

  /**
   * Read an identifier or star from the source.
   * @param index - Start byte.
   * @returns Token text and end byte.
   */
  readName(index: number): { end: number, text: string } {
    let cursor = index
    const first = this.source[cursor] ?? ''
    if (first === '"') {
      cursor += 1
      while (cursor < this.source.length) {
        if (this.source[cursor] === '"') {
          if (this.source[cursor + 1] === '"') {
            cursor += 2
            continue
          }
          cursor += 1
          break
        }
        cursor += 1
      }
      return { end: cursor, text: this.source.slice(index, cursor) }
    }
    if (first === '*') return { end: cursor + 1, text: '*' }
    if (!/[A-Za-z_]/u.test(first)) return { end: cursor, text: '' }
    cursor += 1
    while (/[A-Za-z0-9_$]/u.test(this.source[cursor] ?? '')) cursor += 1
    return { end: cursor, text: this.source.slice(index, cursor) }
  }

  /**
   * Quote an unquoted identifier that contains mixed-case letters.
   * @param text - Identifier text.
   * @returns Identifier text safe for PostgreSQL.
   */
  quoteIdentifier(text: string): string {
    if (!this.quoteIdentifiers || !text || text.startsWith('"') || text === '*') return text
    if (/^__basis_p\d+_+__$/u.test(text)) return text
    return `"${text}"`
  }

  /**
   * Read a dotted identifier from the source.
   * @param index - Start byte.
   * @param count - Number of name parts.
   * @param quoteIdentifiers - Whether to quote camelCase name parts.
   * @returns Qualified text and end byte.
   */
  readQualifiedName(index: number, count: number, quoteIdentifiers = true): { end: number, text: string } {
    let cursor = index
    const parts: string[] = []
    for (let part = 0; part < count; part += 1) {
      while (/\s/u.test(this.source[cursor] ?? '')) cursor += 1
      const name = this.readName(cursor)
      if (!name.text) break
      parts.push(quoteIdentifiers ? this.quoteIdentifier(name.text) : name.text)
      cursor = name.end
      if (part < count - 1) {
        while (/\s/u.test(this.source[cursor] ?? '')) cursor += 1
        if (this.source[cursor] !== '.') break
        cursor += 1
      }
    }
    return { end: cursor, text: parts.join('.') }
  }

  /**
   * Read a type name from the source.
   * @param index - Start byte.
   * @returns Type text.
   */
  readTypeName(index: number): string {
    let cursor = index
    while (/\s/u.test(this.source[cursor] ?? '')) cursor += 1
    const start = cursor
    let name = this.readName(cursor)
    if (!name.text) return ''
    cursor = name.end
    let end = cursor
    while (true) {
      while (/\s/u.test(this.source[cursor] ?? '')) cursor += 1
      if (this.source[cursor] !== '.') break
      cursor += 1
      name = this.readName(cursor)
      if (!name.text) break
      cursor = name.end
      end = cursor
    }
    const suffix = (): void => {
      while (true) {
        const match = /^\s*(?:precision|varying|with\s+time\s+zone|without\s+time\s+zone)/iu
          .exec(this.source.slice(cursor))
        if (!match) break
        cursor += match[0].length
        end = cursor
      }
    }
    suffix()
    while (/\s/u.test(this.source[cursor] ?? '')) cursor += 1
    if (this.source[cursor] === '(') {
      let depth = 0
      while (cursor < this.source.length) {
        if (this.source[cursor] === '(') depth += 1
        if (this.source[cursor] === ')') depth -= 1
        cursor += 1
        if (depth === 0) break
      }
      end = cursor
    }
    suffix()
    while (this.source[cursor] === '[') {
      const close = this.source.indexOf(']', cursor + 1)
      if (close === -1) break
      cursor = close + 1
      end = cursor
    }
    return this.source.slice(start, end)
  }

  /**
   * Read a literal from the source.
   * @param index - Start byte.
   * @returns Literal text.
   */
  readLiteral(index: number): string {
    let cursor = index
    while (/\s/u.test(this.source[cursor] ?? '')) cursor += 1
    const start = cursor
    const first = this.source[cursor] ?? ''
    if (first === "'") {
      cursor += 1
      while (cursor < this.source.length) {
        if (this.source[cursor] === "'") {
          if (this.source[cursor + 1] === "'") {
            cursor += 2
            continue
          }
          cursor += 1
          break
        }
        cursor += 1
      }
      return this.source.slice(start, cursor)
    }
    if ((first === 'B' || first === 'X' || first === 'E') && this.source[cursor + 1] === "'") {
      cursor += 1
      const quoted = this.readLiteral(cursor)
      return `${first}${quoted}`
    }
    if (first === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(this.source.slice(cursor))?.[0]
      if (tag) {
        const close = this.source.indexOf(tag, cursor + tag.length)
        return close === -1 ? this.source.slice(start) : this.source.slice(start, close + tag.length)
      }
    }
    const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/u.exec(this.source.slice(cursor))?.[0]
    if (number) return number
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/u.exec(this.source.slice(cursor))?.[0]
    if (word) return word
    return this.source.slice(cursor, cursor + 1)
  }

  /**
   * Scan a small source segment into lightweight tokens.
   * @param start - Start byte.
   * @param limit - End byte.
   * @returns Tokens in source order.
   */
  scan(start: number, limit: number): { end: number, start: number, text: string }[] {
    const tokens: { end: number, start: number, text: string }[] = []
    let cursor = start
    while (cursor < limit) {
      const character = this.source[cursor] ?? ''
      if (/\s/u.test(character)) {
        cursor += 1
        continue
      }
      if (character === '-' && this.source[cursor + 1] === '-') {
        const newline = this.source.indexOf('\n', cursor + 2)
        cursor = newline === -1 ? limit : newline + 1
        continue
      }
      if (character === '/' && this.source[cursor + 1] === '*') {
        const close = this.source.indexOf('*/', cursor + 2)
        cursor = close === -1 ? limit : close + 2
        continue
      }
      if (character === "'" || character === '"') {
        const quote = character
        let end = cursor + 1
        while (end < limit) {
          if (this.source[end] === quote) {
            if (this.source[end + 1] === quote) {
              end += 2
              continue
            }
            end += 1
            break
          }
          end += 1
        }
        tokens.push({ end, start: cursor, text: this.source.slice(cursor, end) })
        cursor = end
        continue
      }
      if (character === '$') {
        const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(this.source.slice(cursor, limit))?.[0]
        if (tag) {
          const close = this.source.indexOf(tag, cursor + tag.length)
          const end = close === -1 ? limit : close + tag.length
          tokens.push({ end, start: cursor, text: this.source.slice(cursor, end) })
          cursor = end
          continue
        }
      }
      if (/[A-Za-z_]/u.test(character)) {
        let end = cursor + 1
        while (/[A-Za-z0-9_$]/u.test(this.source[end] ?? '')) end += 1
        tokens.push({ end, start: cursor, text: this.source.slice(cursor, end) })
        cursor = end
        continue
      }
      tokens.push({ end: cursor + 1, start: cursor, text: character })
      cursor += 1
    }
    return tokens
  }

  /**
   * Find a target alias and preserve its source spelling.
   * @param body - ResTarget body.
   * @param limit - End of the search segment.
   * @returns Alias suffix, or empty.
   */
  alias(body: any, limit: number): string {
    if (!body.name) return ''
    const start = typeof body.location === 'number' && body.location >= 0 ? body.location : 0
    const top: { text: string }[] = []
    let depth = 0
    for (const current of this.scan(start, limit)) {
      if (current.text === '(') {
        depth += 1
        top.push(current)
        continue
      }
      if (current.text === ')') {
        if (depth === 0) break
        depth -= 1
        top.push(current)
        continue
      }
      if (depth === 0 && (current.text === ',' || current.text === ';')) break
      if (depth === 0 && ALIAS_STOP_WORDS.has(current.text.toLowerCase())) break
      top.push(current)
    }
    const asIndex = top.findIndex(candidate => candidate.text.toLowerCase() === 'as')
    const candidate = asIndex >= 0 ? top[asIndex + 1] : top[top.length - 1]
    return candidate ? ` AS ${this.quoteIdentifier(candidate.text)}` : ` AS ${this.quoteIdentifier(body.name)}`
  }

  /**
   * Find the end of a target-list entry, including comments.
   * @param body - SelectStmt body.
   * @param targets - Target nodes.
   * @param index - Target index.
   * @returns End byte.
   */
  targetLimit(body: any, targets: readonly any[], index: number): number {
    if (index < targets.length - 1) return this.startLocation(targets[index + 1])
    const starts = [
      body.fromClause?.[0],
      body.whereClause,
      body.groupClause?.[0],
      body.havingClause,
      body.sortClause?.[0],
      body.limitCount,
      body.limitOffset,
    ].map((node: any) => this.startLocation(node)).filter((value: number) => value >= 0)
    return starts.length > 0 ? Math.min(...starts) : this.end
  }

  /**
   * Print a target-list entry.
   * @param node - ResTarget.
   * @param limit - End of the search segment.
   * @returns Target lines without outer indentation.
   */
  target(node: any, limit: number): string[] {
    const body = this.tag(node)?.[1]
    if (!body) return []
    const tagged = this.tag(body.val)
    const alias = this.alias(body, limit)
    let lines: string[]
    if (tagged?.[0] === 'CaseExpr') {
      lines = this.caseLines(tagged[1], alias)
    } else if (tagged?.[0] === 'FuncCall' || tagged?.[0] === 'CoalesceExpr') {
      lines = this.callLines(tagged[0], tagged[1], '')
      if (lines.length === 1) lines[0] = `${lines[0]}${alias}`
      else lines[lines.length - 1] = `${lines[lines.length - 1]}${alias}`
    } else {
      lines = [`${this.expr(body.val)}${alias}`]
    }
    const full: string[] = []
    for (const comment of this.comments) {
      if (this.#usedComments.has(comment.start)) continue
      if (body.location < 0 || comment.start < body.location || comment.start >= limit) continue
      this.#usedComments.add(comment.start)
      if (this.inlineComment(comment.start)) {
        lines[lines.length - 1] = `${lines[lines.length - 1]} ${comment.text.trim()}`
      } else {
        full.push(comment.text.trim())
      }
    }
    return [...full, ...lines]
  }

  /**
   * Check whether a comment shares a line with preceding SQL.
   * @param start - Comment start byte.
   * @returns Whether the comment is inline.
   */
  inlineComment(start: number): boolean {
    const lineStart = this.source.lastIndexOf('\n', start - 1) + 1
    return this.source.slice(lineStart, start).trim() !== ''
  }

  /**
   * Emit full-line comments in a source range.
   * @param start - Range start.
   * @param end - Range end.
   * @param indent - Prefix for the comment.
   * @returns Comment lines.
   */
  fullLineComments(start: number, end: number, indent: string): string[] {
    const lines: string[] = []
    for (const comment of this.comments) {
      if (this.#usedComments.has(comment.start)) continue
      if (comment.start < start || comment.start >= end || this.inlineComment(comment.start)) continue
      this.#usedComments.add(comment.start)
      lines.push(`${indent}${comment.text.trim()}`)
    }
    return lines
  }

  /**
   * Print a multi-line CASE expression.
   * @param body - CaseExpr body.
   * @param alias - Alias suffix.
   * @returns Formatted lines.
   */
  caseLines(body: any, alias: string): string[] {
    const lines = [`CASE${body.arg ? ` ${this.expr(body.arg)}` : ''}`]
    for (const when of body.args ?? []) {
      const clause = this.tag(when)?.[1]
      if (!clause) continue
      lines.push(`  WHEN ${this.expr(clause.expr)} THEN ${this.expr(clause.result)}`)
    }
    if (body.defresult) lines.push(`  ELSE ${this.expr(body.defresult)}`)
    lines.push(`END${alias}`)
    return lines
  }

  /**
   * Print one statement or select node.
   * @param node - Raw node.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  lines(node: any, indent: string): string[] {
    const tagged = this.tag(node)
    if (!tagged) return []
    switch (tagged[0]) {
      case 'SelectStmt': return this.select(tagged[1], indent)
      case 'InsertStmt': return this.insert(tagged[1], indent)
      case 'ViewStmt': return this.view(tagged[1], indent)
      case 'CreateStmt': return this.createTable(tagged[1], indent)
      case 'CreateFunctionStmt': return this.createFunction(tagged[1], indent)
      case 'DoStmt': return this.doBlock(tagged[1], indent)
      case 'UpdateStmt': return this.update(tagged[1], indent)
      case 'DeleteStmt': return this.delete(tagged[1], indent)
      case 'VariableSetStmt': return this.variableSet(tagged[1], indent)
      case 'ConstraintsSetStmt': {
        const timing = tagged[1].deferred ? 'DEFERRED' : 'IMMEDIATE'
        return [`${indent}SET CONSTRAINTS ALL ${timing}`]
      }
      case 'DropStmt': return this.drop(tagged[1], indent)
      case 'IndexStmt': return this.index(tagged[1], indent)
      case 'VacuumStmt': return this.vacuum(tagged[1], indent)
      case 'CreateSeqStmt': return this.createSequence(tagged[1], indent)
      case 'AlterTableStmt': return this.alterTable(tagged[1], indent)
      case 'CreateSchemaStmt': return this.createSchema(tagged[1], indent)
      case 'CreateTrigStmt': return this.createTrigger(tagged[1], indent)
      default: throw new Error(`Unsupported SQL statement: ${tagged[0]}`)
    }
  }

  /**
   * Print a SELECT statement.
   * @param body - SelectStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  select(body: any, indent: string): string[] {
    const distinctOn = body.distinctClause?.some((item: any) => item?.ResTarget?.name || item?.ResTarget?.val)
    if (distinctOn) throw new Error('Unsupported SELECT DISTINCT ON')
    if (body.intoClause || body.windowClause?.length || body.lockingClause?.length || body.sampleClause) {
      throw new Error('Unsupported SELECT clause')
    }
    if (body.withClause) return this.withSelect(body, indent)
    if (body.op && body.op !== 'SETOP_NONE') return this.setOperation(body, indent)
    if (body.valuesLists) return this.values(body.valuesLists, indent)
    const nodes = body.targetList ?? []
    const targets = nodes.map((target: any, index: number) => (
      this.target(target, this.targetLimit(body, nodes, index))
    ))
    const targetText = targets.map((target: string[]) => target.join(' ')).join(', ')
    const distinct = body.distinctClause?.length ? 'DISTINCT ' : ''
    const multiline = targets.some((target: string[]) => target.length > 1)
      || targets.some((target: string[]) => target.some(line => line.includes('--')))
      || (`${indent}SELECT ${targetText}`.length > 100)
    const lines: string[] = []
    if (multiline && targets.length === 1) {
      const [first, ...rest] = targets[0] as string[]
      lines.push(`${indent}SELECT ${distinct}${first}`)
      for (const line of rest) lines.push(`${indent}${line}`)
    } else if (multiline) {
      lines.push(`${indent}SELECT${distinct ? ` ${distinct.trim()}` : ''}`)
      targets.forEach((target: string[], index: number) => {
        const copy = target.map(line => `${indent}  ${line}`)
        if (index < targets.length - 1 && copy.length > 0) {
          const last = copy[copy.length - 1]
          copy[copy.length - 1] = last.includes(' --') ? last.replace(' --', ', --') : `${last},`
        }
        lines.push(...copy)
      })
    } else {
      lines.push(`${indent}SELECT ${distinct}${targetText}`)
    }
    if (body.fromClause?.length) lines.push(...this.from(body.fromClause, indent))
    if (body.whereClause) {
      const fromStart = body.fromClause?.length ? this.startLocation(body.fromClause[0]) : this.start
      const whereStart = this.startLocation(body.whereClause)
      if (fromStart >= 0 && whereStart >= 0) lines.push(...this.fullLineComments(fromStart, whereStart, indent))
      lines.push(...this.condition(body.whereClause, indent, 'WHERE'))
    }
    if (body.groupClause?.length) {
      lines.push(`${indent}GROUP BY ${body.groupClause.map((item: any) => this.expr(item)).join(', ')}`)
    }
    if (body.havingClause) lines.push(...this.condition(body.havingClause, indent, 'HAVING'))
    if (body.sortClause?.length) {
      lines.push(`${indent}ORDER BY ${body.sortClause.map((item: any) => this.sort(item)).join(', ')}`)
    }
    if (body.limitCount) lines.push(`${indent}LIMIT ${this.expr(body.limitCount)}`)
    if (body.limitOffset) lines.push(`${indent}OFFSET ${this.expr(body.limitOffset)}`)
    return lines
  }

  /**
   * Print a WITH query.
   * @param body - SelectStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  withSelect(body: any, indent: string): string[] {
    const lines = this.withClauseLines(body.withClause, indent)
    const rest = { ...body, withClause: undefined }
    lines.push(...this.select(rest, indent))
    return lines
  }

  /**
   * Format a WITH clause.
   * @param withClause - WithClause node.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  withClauseLines(withClause: any, indent: string): string[] {
    const ctes = withClause.ctes ?? []
    const lines: string[] = []
    const prefix = withClause.recursive ? 'WITH RECURSIVE' : 'WITH'
    ctes.forEach((node: any, index: number) => {
      const cte = this.tag(node)?.[1]
      if (!cte) return
      const location = typeof cte.location === 'number' && cte.location >= 0 ? cte.location : -1
      const name = location >= 0 ? this.quoteIdentifier(this.readName(location).text) : cte.ctename
      const lead = index === 0 ? `${indent}${prefix}` : indent
      lines.push(`${lead} ${name} AS (`)
      lines.push(...this.lines(cte.ctequery, `${indent}  `))
      lines.push(`${indent})${index < ctes.length - 1 ? ',' : ''}`)
    })
    return lines
  }

  /**
   * Print a set operation.
   * @param body - SelectStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  setOperation(body: any, indent: string): string[] {
    const operator = body.op === 'SETOP_INTERSECT'
      ? 'INTERSECT'
      : body.op === 'SETOP_EXCEPT' ? 'EXCEPT' : 'UNION'
    const keyword = body.all ? `${operator} ALL` : operator
    return [
      ...this.selectNode(body.larg, indent),
      '',
      `${indent}${keyword}`,
      '',
      ...this.selectNode(body.rarg, indent),
    ]
  }

  /**
   * Print a SelectStmt body or tagged SelectStmt.
   * @param node - Select node.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  selectNode(node: any, indent: string): string[] {
    const tagged = this.tag(node)
    if (tagged?.[0] === 'SelectStmt') return this.select(tagged[1], indent)
    if (node?.targetList || node?.fromClause || node?.whereClause || node?.valuesLists || node?.op) {
      return this.select(node, indent)
    }
    return []
  }

  /**
   * Print a VALUES query.
   * @param rows - valuesLists nodes.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  values(rows: readonly any[], indent: string): string[] {
    const lines = [`${indent}VALUES`]
    rows.forEach((node: any, index: number) => {
      const row = this.tag(node)?.[1]
      const items = (row?.items ?? []).map((item: any) => this.expr(item)).join(', ')
      lines.push(`${indent}  (${items})${index < rows.length - 1 ? ',' : ''}`)
    })
    return lines
  }

  /**
   * Print FROM entries.
   * @param items - From-clause nodes.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  from(items: readonly any[], indent: string): string[] {
    const lines = [`${indent}FROM ${this.fromItem(items[0]).replace(/\n/gu, `\n${indent}`)}`]
    for (const item of items.slice(1)) {
      lines.push(`${indent}, ${this.fromItem(item).replace(/\n/gu, `\n${indent}`)}`)
    }
    return lines
  }

  /**
   * Print one FROM item.
   * @param node - RangeVar or JoinExpr.
   * @returns Inline text.
   */
  fromItem(node: any): string {
    const tagged = this.tag(node)
    if (tagged?.[0] === 'JoinExpr') {
      const body = tagged[1]
      if (body.usingClause?.length || body.isNatural || body.alias) throw new Error('Unsupported JOIN')
      const cross = !body.quals && !body.usingClause?.length && !body.isNatural
      const join = cross ? 'CROSS JOIN' : this.joinName(body.jointype)
      const left = this.fromItem(body.larg)
      const right = this.fromItem(body.rarg)
      const on = body.quals ? ` ON ${this.expr(body.quals)}` : ''
      return `${left}\n${join} ${right}${on}`
    }
    if (tagged?.[0] === 'RangeVar') return this.rangeVar(tagged[1])
    if (tagged?.[0] === 'RangeFunction') return this.rangeFunction(tagged[1])
    if (node?.relname) return this.rangeVar(node)
    throw new Error(`Unsupported FROM item: ${tagged?.[0] ?? 'unknown'}`)
  }

  /**
   * Map a JoinType to SQL.
   * @param jointype - JoinType enum.
   * @returns Join keyword.
   */
  joinName(jointype: string): string {
    switch (jointype) {
      case 'JOIN_LEFT': return 'LEFT JOIN'
      case 'JOIN_RIGHT': return 'RIGHT JOIN'
      case 'JOIN_FULL': return 'FULL JOIN'
      case 'JOIN_CROSS': return 'CROSS JOIN'
      case 'JOIN_INNER': return 'JOIN'
      default: return 'JOIN'
    }
  }

  /**
   * Format a set-returning function in FROM.
   * @param body - RangeFunction body.
   * @returns Function text.
   */
  rangeFunction(body: any): string {
    const items = (body.functions ?? []).flatMap((node: any) => this.tag(node)?.[1]?.items ?? [])
    const call = items.map((node: any) => this.tag(node)).find((tagged: any) => tagged?.[0] === 'FuncCall')
    const text = call ? this.funcCall(call[1]) : ''
    const ordinality = body.ordinality ? ' WITH ORDINALITY' : ''
    const alias = body.alias
      ? ` ${this.quoteIdentifier(body.alias.aliasname)}` +
        (body.alias.colnames?.length ? ` (${this.identifierList(body.alias.colnames)})` : '')
      : ''
    return `${text}${ordinality}${alias}`
  }

  /**
   * Print a relation name and alias.
   * @param body - RangeVar body.
   * @returns Relation text.
   */
  rangeVar(body: any): string {
    const location = typeof body.location === 'number' && body.location >= 0 ? body.location : -1
    const count = 1 + (body.schemaname ? 1 : 0) + (body.catalogname ? 1 : 0)
    const relation = location >= 0
      ? this.readQualifiedName(location, count)
      : { end: location, text: [body.catalogname, body.schemaname, body.relname].filter(Boolean).join('.') }
    if (!body.alias) return relation.text
    const tokens: { text: string }[] = []
    let depth = 0
    for (const current of this.scan(relation.end, this.end)) {
      if (current.text === '(') {
        depth += 1
        tokens.push(current)
        continue
      }
      if (current.text === ')') {
        if (depth === 0) break
        depth -= 1
        tokens.push(current)
        continue
      }
      if (depth === 0 && (current.text === ',' || current.text === ';')) break
      if (depth === 0 && ALIAS_STOP_WORDS.has(current.text.toLowerCase())) break
      tokens.push(current)
    }
    const asIndex = tokens.findIndex(candidate => candidate.text.toLowerCase() === 'as')
    const candidate = asIndex >= 0 ? tokens[asIndex + 1] : tokens[tokens.length - 1]
    if (!candidate) return `${relation.text} ${this.quoteIdentifier(body.alias.aliasname)}`
    return `${relation.text}${asIndex >= 0 ? ' AS' : ''} ${this.quoteIdentifier(candidate.text)}`
  }

  /**
   * Print a WHERE/HAVING condition, splitting top-level booleans.
   * @param node - Condition node.
   * @param indent - Prefix for this block.
   * @param keyword - WHERE or HAVING.
   * @returns Formatted lines.
   */
  condition(node: any, indent: string, keyword: string): string[] {
    const tagged = this.tag(node)
    if (tagged?.[0] !== 'BoolExpr' || (tagged[1].boolop !== 'AND_EXPR' && tagged[1].boolop !== 'OR_EXPR')) {
      return [`${indent}${keyword} ${this.expr(node)}`]
    }
    const body = tagged[1]
    const operator = body.boolop === 'AND_EXPR' ? 'AND' : 'OR'
    const [first, ...rest] = body.args ?? []
    const lines = [`${indent}${keyword} ${this.expr(first)}`]
    for (const arg of rest) lines.push(`${indent}  ${operator} ${this.expr(arg)}`)
    return lines
  }

  /**
   * Print a sort item.
   * @param node - SortBy.
   * @returns Inline text.
   */
  sort(node: any): string {
    const body = this.tag(node)?.[1]
    if (!body) return ''
    let direction = ''
    if (body.sortby_dir === 'SORTBY_DESC') direction = ' DESC'
    else if (body.sortby_dir === 'SORTBY_ASC') direction = ' ASC'
    else if (body.sortby_dir === 'SORTBY_USING') {
      direction = ` USING ${body.useOp?.map((part: any) => this.expr(part)).join('.')}`
    }
    const nulls = body.sortby_nulls === 'SORTBY_NULLS_FIRST' ? ' NULLS FIRST'
      : body.sortby_nulls === 'SORTBY_NULLS_LAST' ? ' NULLS LAST' : ''
    return `${this.expr(body.node)}${direction}${nulls}`
  }

  /**
   * Print a relation name without its alias.
   * @param body - RangeVar body.
   * @returns Qualified relation name.
   */
  relationName(body: any): string {
    if (!body) return ''
    const count = 1 + (body.schemaname ? 1 : 0) + (body.catalogname ? 1 : 0)
    if (typeof body.location === 'number' && body.location >= 0) {
      return this.readQualifiedName(body.location, count).text
    }
    return [body.catalogname, body.schemaname, body.relname].filter(Boolean).join('.')
  }

  /**
   * Print a CREATE VIEW statement.
   * @param body - ViewStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  view(body: any, indent: string): string[] {
    const view = this.tag(body.view)?.[1] ?? body.view
    const relation = this.relationName(view)
    const replace = body.replace ? 'OR REPLACE ' : ''
    return [
      `${indent}CREATE ${replace}VIEW ${relation} AS (`,
      ...this.lines(body.query, `${indent}  `),
      `${indent})`,
    ]
  }

  /**
   * Print an INSERT statement.
   * @param body - InsertStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  insert(body: any, indent: string): string[] {
    const relation = this.tag(body.relation)?.[1] ?? body.relation
    const relationText = this.relationName(relation)
    const columns = (body.cols ?? []).map((node: any) => {
      const column = this.tag(node)?.[1]
      if (!column) return ''
      return typeof column.location === 'number' && column.location >= 0
        ? this.quoteIdentifier(this.readName(column.location).text)
        : column.name
    }).filter((column: string) => column.length > 0)
    const header = columns.length > 0
      ? `${indent}INSERT INTO ${relationText} (${columns.join(', ')})`
      : `${indent}INSERT INTO ${relationText}`
    const select = this.tag(body.selectStmt)?.[1]
    const lines = [...(body.withClause ? this.withClauseLines(body.withClause, indent) : []), header]
    if (select?.valuesLists) lines.push(...this.values(select.valuesLists, indent))
    else if (select) lines.push(...this.select(select, indent))
    if (body.onConflictClause) lines.push(...this.onConflict(body.onConflictClause, indent))
    const returningList = body.returningClause?.exprs ?? body.returningList ?? []
    if (returningList.length) {
      const returning = returningList.map((node: any, index: number) => {
        const next = returningList[index + 1]
        const limit = next ? this.startLocation(next) : this.end
        return this.target(node, limit < 0 ? this.end : limit).join(' ')
      }).join(', ')
      lines.push(`${indent}RETURNING ${returning}`)
    }
    return lines
  }

  /**
   * Format a CREATE TABLE statement.
   * @param body - CreateStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  createTable(body: any, indent: string): string[] {
    const relation = this.relationName(body.relation)
    const elements = body.tableElts ?? []
    const lines = [`${indent}CREATE TABLE ${body.if_not_exists ? 'IF NOT EXISTS ' : ''}${relation} (`]
    elements.forEach((node: any, index: number) => {
      const tagged = this.tag(node)
      const text = tagged?.[0] === 'ColumnDef'
        ? this.columnDef(tagged[1])
        : tagged?.[0] === 'Constraint' ? this.tableConstraint(tagged[1]) : ''
      if (text) lines.push(`${indent}  ${text}${index < elements.length - 1 ? ',' : ''}`)
    })
    lines.push(`${indent})`)
    return lines
  }

  /**
   * Format one CREATE TABLE column definition.
   * @param body - ColumnDef body.
   * @returns Column definition.
   */
  columnDef(body: any): string {
    const name = typeof body.location === 'number' && body.location >= 0
      ? this.quoteIdentifier(this.readName(body.location).text)
      : this.quoteIdentifier(body.colname)
    const type = this.formatTypeName(body.typeName)
    const constraints = (body.constraints ?? [])
      .map((node: any) => this.tag(node)?.[1])
      .filter(Boolean)
      .map((constraint: any) => this.columnConstraint(constraint))
      .filter(Boolean)
    return [name, type, ...constraints].join(' ')
  }

  /**
   * Format a type name for DDL.
   * @param body - TypeName body.
   * @returns Uppercase type name.
   */
  formatTypeName(body: any): string {
    const raw = body?.location >= 0 ? this.readTypeName(body.location) : this.typeNameText(body)
    if (!raw || raw.startsWith('"')) return raw
    return raw.replace(/[a-z_][a-z0-9_$]*/giu, word => word.toUpperCase())
  }

  /**
   * Format an identifier list from String nodes.
   * @param nodes - String nodes.
   * @returns Quoted identifiers.
   */
  identifierList(nodes: readonly any[]): string {
    return nodes.map(node => this.quoteIdentifier(this.tag(node)?.[1]?.sval ?? '')).join(', ')
  }

  /**
   * Format a column constraint.
   * @param body - Constraint body.
   * @returns Constraint text.
   */
  columnConstraint(body: any): string {
    switch (body.contype) {
      case 'CONSTR_PRIMARY': return 'PRIMARY KEY'
      case 'CONSTR_NOTNULL': return 'NOT NULL'
      case 'CONSTR_NULL': return 'NULL'
      case 'CONSTR_DEFAULT': return `DEFAULT ${this.expr(body.raw_expr)}`
      case 'CONSTR_FOREIGN': {
        const keys = this.identifierList(body.pk_attrs ?? [])
        return `REFERENCES ${this.relationName(body.pktable)}${keys ? ` (${keys})` : ''}`
      }
      case 'CONSTR_UNIQUE': return `UNIQUE (${this.identifierList(body.keys ?? [])})`
      case 'CONSTR_CHECK': return `CHECK (${this.expr(body.raw_expr)})`
      default: throw new Error(`Unsupported column constraint: ${body.contype}`)
    }
  }

  /**
   * Format a table-level constraint.
   * @param body - Constraint body.
   * @returns Constraint text.
   */
  tableConstraint(body: any): string {
    switch (body.contype) {
      case 'CONSTR_PRIMARY': return `PRIMARY KEY (${this.identifierList(body.keys ?? [])})`
      case 'CONSTR_UNIQUE': return `UNIQUE (${this.identifierList(body.keys ?? [])})`
      case 'CONSTR_CHECK': return `CHECK (${this.expr(body.raw_expr)})`
      case 'CONSTR_FOREIGN': {
        const columns = this.identifierList(body.fk_attrs ?? [])
        const keys = this.identifierList(body.pk_attrs ?? [])
        return `FOREIGN KEY (${columns}) REFERENCES ${this.relationName(body.pktable)}${keys ? ` (${keys})` : ''}`
      }
      default: return this.columnConstraint(body)
    }
  }

  /**
   * Format a CREATE FUNCTION statement.
   * @param body - CreateFunctionStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  createFunction(body: any, indent: string): string[] {
    const name = (body.funcname ?? []).map((part: any) => this.tag(part)?.[1]?.sval ?? '').join('.')
    const language = this.optionValue(body.options, 'language') ?? 'plpgsql'
    const returnType = this.formatTypeName(body.returnType)
    const header = `${indent}CREATE ${body.replace ? 'OR REPLACE ' : ''}FUNCTION ${name}() RETURNS ${returnType} AS $$`
    const parsed = parsePlPgSQLSync(this.source.slice(this.start, this.end)) as any
    const func = parsed.plpgsql_funcs?.[0]?.PLpgSQL_function
    const bodyText = this.optionBody(body.options)
    const lines = func ? new PlPgSqlPrinter(this.plBodyComments(bodyText), func, this.start, this.end).print() : []
    const terminated = this.source[this.end] === ';' || this.source.slice(this.start, this.end).trimEnd().endsWith(';')
    return [header, ...lines, `${indent}$$ LANGUAGE ${language}${terminated ? ';' : ''}`]
  }

  /**
   * Format a DO statement.
   * @param _body - DoStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  doBlock(_body: any, indent: string): string[] {
    const parsed = parsePlPgSQLSync(this.source.slice(this.start, this.end)) as any
    const func = parsed.plpgsql_funcs?.[0]?.PLpgSQL_function
    const bodyText = this.doBody(_body)
    const lines = func ? new PlPgSqlPrinter(this.plBodyComments(bodyText), func, this.start, this.end).print() : []
    return [`${indent}DO $$`, ...lines, `${indent}$$`]
  }

  /**
   * Read a function body option.
   * @param options - DefElem list.
   * @returns Body text.
   */
  optionBody(options: readonly any[]): string {
    const option = (options ?? []).map(node => this.tag(node)?.[1]).find((node: any) => node?.defname === 'as')
    const arg = option?.arg
    if (arg?.String?.sval) return arg.String.sval
    return (arg?.List?.items ?? []).map((item: any) => this.tag(item)?.[1]?.sval ?? '').join('')
  }

  /**
   * Read a DO body.
   * @param body - DoStmt body.
   * @returns Body text.
   */
  doBody(body: any): string {
    const option = (body.args ?? []).map((node: any) => this.tag(node)?.[1]).find((node: any) => node?.defname === 'as')
    return option?.arg?.String?.sval ?? ''
  }

  /**
   * Collect comments from a PL/pgSQL body.
   * @param bodyText - Body source text.
   * @returns Comments with absolute locations.
   */
  plBodyComments(bodyText: string): SqlComment[] {
    if (!bodyText) return [...this.comments]
    const bodyStart = this.source.indexOf(bodyText, this.start)
    const base = bodyStart < 0 ? this.start : bodyStart
    const comments: SqlComment[] = [...this.comments]
    const pattern = /--[^\n]*|\/\*[\s\S]*?\*\//gu
    for (const match of bodyText.matchAll(pattern)) {
      const start = base + (match.index ?? 0)
      comments.push({
        end: start + match[0].length,
        line: this.source.slice(0, start).split('\n').length,
        start,
        text: match[0],
      })
    }
    return comments
  }

  /**
   * Read one function option.
   * @param options - DefElem list.
   * @param name - Option name.
   * @returns Option value, or null.
   */
  optionValue(options: readonly any[], name: string): string | null {
    const option = (options ?? []).map(node => this.tag(node)?.[1]).find((node: any) => node?.defname === name)
    return option?.arg?.String?.sval ?? null
  }

  /**
   * Format an UPDATE statement.
   * @param body - UpdateStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  update(body: any, indent: string): string[] {
    const relation = this.relationName(this.tag(body.relation)?.[1] ?? body.relation)
    const updates = (body.targetList ?? []).map((node: any) => {
      const target = this.tag(node)?.[1]
      if (!target) return ''
      const name = typeof target.location === 'number' && target.location >= 0
        ? this.quoteIdentifier(this.readName(target.location).text)
        : this.quoteIdentifier(target.name)
      return `${name} = ${this.expr(target.val)}`
    }).filter(Boolean)
    const lines = [`${indent}UPDATE ${relation} SET ${updates.join(', ')}`]
    if (body.whereClause) {
      const fromStart = body.fromClause?.length ? this.startLocation(body.fromClause[0]) : this.start
      const whereStart = this.startLocation(body.whereClause)
      if (fromStart >= 0 && whereStart >= 0) lines.push(...this.fullLineComments(fromStart, whereStart, indent))
      lines.push(...this.condition(body.whereClause, indent, 'WHERE'))
    }
    return lines
  }

  /**
   * Format a DELETE statement.
   * @param body - DeleteStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  delete(body: any, indent: string): string[] {
    const relation = this.relationName(this.tag(body.relation)?.[1] ?? body.relation)
    const lines = [`${indent}DELETE FROM ${relation}`]
    if (body.whereClause) {
      const fromStart = body.fromClause?.length ? this.startLocation(body.fromClause[0]) : this.start
      const whereStart = this.startLocation(body.whereClause)
      if (fromStart >= 0 && whereStart >= 0) lines.push(...this.fullLineComments(fromStart, whereStart, indent))
      lines.push(...this.condition(body.whereClause, indent, 'WHERE'))
    }
    return lines
  }

  /**
   * Format a SET statement.
   * @param body - VariableSetStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  variableSet(body: any, indent: string): string[] {
    const values = (body.args ?? []).map((arg: any) => {
      const tagged = this.tag(arg)
      if (tagged?.[0] === 'A_Const') {
        const value = tagged[1]?.sval?.sval
        return value ? this.quoteIdentifier(value) : this.expr(arg)
      }
      return this.expr(arg)
    })
    return [`${indent}SET ${body.name}${values.length ? ` TO ${values.join(', ')}` : ''}`]
  }

  /**
   * Format a DROP statement.
   * @param body - DropStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  drop(body: any, indent: string): string[] {
    const types: Record<string, string> = {
      OBJECT_INDEX: 'INDEX',
      OBJECT_SCHEMA: 'SCHEMA',
      OBJECT_SEQUENCE: 'SEQUENCE',
      OBJECT_TABLE: 'TABLE',
      OBJECT_TRIGGER: 'TRIGGER',
      OBJECT_VIEW: 'VIEW',
    }
    const names = (body.objects ?? []).map((object: any) => {
      const items = this.tag(object)?.[1]?.items ?? []
      return this.identifierList(items)
    }).join(', ')
    const behavior = body.behavior === 'DROP_CASCADE' ? ' CASCADE' : ''
    return [`${indent}DROP ${types[body.removeType] ?? body.removeType} ${names}${behavior}`]
  }

  /**
   * Format a CREATE INDEX statement.
   * @param body - IndexStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  index(body: any, indent: string): string[] {
    if (body.unique || body.whereClause) throw new Error('Unsupported index clause')
    const params = (body.indexParams ?? []).map((node: any) => {
      const elem = this.tag(node)?.[1]
      if (!elem?.name || elem.expr) throw new Error('Unsupported index expression')
      const name = this.quoteIdentifier(elem.name)
      const opclass = (elem.opclass ?? []).map((part: any) => this.tag(part)?.[1]?.sval ?? '').filter(Boolean)
      return `${name}${opclass.length ? ` ${opclass.join(' ')}` : ''}`
    }).filter(Boolean)
    return [
      `${indent}CREATE INDEX ${this.quoteIdentifier(body.idxname)} ON ${this.relationName(body.relation)}` +
        `${body.accessMethod ? ` USING ${body.accessMethod}` : ''}(${params.join(', ')})`,
    ]
  }

  /**
   * Format an ANALYZE or VACUUM statement.
   * @param body - VacuumStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  vacuum(body: any, indent: string): string[] {
    const relations = (body.rels ?? []).map((node: any) => (
      this.relationName(this.tag(node)?.[1]?.relation)
    )).filter(Boolean)
    return [`${indent}ANALYZE${relations.length ? ` ${relations.join(', ')}` : ''}`]
  }

  /**
   * Format a CREATE SEQUENCE statement.
   * @param body - CreateSeqStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  createSequence(body: any, indent: string): string[] {
    const options = (body.options ?? []).map((node: any) => {
      const option = this.tag(node)?.[1]
      if (!option) return ''
      const value = option.arg?.Integer?.ival ?? option.arg?.Float?.fval ?? option.arg?.String?.sval
      return `${String(option.defname).toUpperCase()}${value === undefined ? '' : ` ${value}`}`
    }).filter(Boolean)
    const sequence = this.relationName(body.sequence)
    return [`${indent}CREATE SEQUENCE ${sequence}${options.length ? ` ${options.join(' ')}` : ''}`]
  }

  /**
   * Format an ALTER TABLE statement.
   * @param body - AlterTableStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  alterTable(body: any, indent: string): string[] {
    const commands: Record<string, string> = Object.fromEntries([
      ['AT_DisableRowSecurity', 'DISABLE ROW LEVEL SECURITY'],
      ['AT_EnableRowSecurity', 'ENABLE ROW LEVEL SECURITY'],
      ['AT_ForceRowSecurity', 'FORCE ROW LEVEL SECURITY'],
      ['AT_NoForceRowSecurity', 'NO FORCE ROW LEVEL SECURITY'],
    ])
    const cmds = (body.cmds ?? []).map((node: any) => (
      commands[this.tag(node)?.[1]?.subtype] ?? ''
    )).filter(Boolean)
    return [`${indent}ALTER TABLE ${this.relationName(body.relation)} ${cmds.join(' ')}`]
  }

  /**
   * Format a CREATE SCHEMA statement.
   * @param body - CreateSchemaStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  createSchema(body: any, indent: string): string[] {
    return [`${indent}CREATE SCHEMA ${this.quoteIdentifier(body.schemaname)}`]
  }

  /**
   * Format a CREATE TRIGGER statement.
   * @param body - CreateTrigStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  createTrigger(body: any, indent: string): string[] {
    const timing = body.timing === 2 ? 'BEFORE ' : body.timing === 4 ? 'AFTER ' : 'INSTEAD OF '
    const eventBits = body.events ?? 0
    const events = [
      eventBits & 4 ? 'INSERT' : '',
      eventBits & 8 ? 'DELETE' : '',
      eventBits & 16 ? 'UPDATE' : '',
      eventBits & 32 ? 'TRUNCATE' : '',
    ].filter(Boolean).join(' OR ')
    const func = (body.funcname ?? [])
      .map((part: any) => this.quoteIdentifier(this.tag(part)?.[1]?.sval ?? ''))
      .join('.')
    return [
      `${indent}CREATE TRIGGER ${this.quoteIdentifier(body.trigname)} ${timing}${events}` +
        ` ON ${this.relationName(body.relation)}` +
        ` FOR EACH ${body.row ? 'ROW' : 'STATEMENT'} EXECUTE FUNCTION ${func}()`,
    ]
  }

  /**
   * Reconstruct an ON CONFLICT target from the source so quoting survives.
   * @param body - OnConflictClause body.
   * @returns Target clause text, or empty.
   */
  onConflictTarget(body: any): string {
    if (typeof body.location !== 'number' || body.location < 0) return ''
    const tokens = this.scan(body.location, this.end)
    const conflict = tokens.findIndex((candidate: any) => candidate.text.toLowerCase() === 'conflict')
    if (conflict < 0) return ''
    const next = tokens[conflict + 1]
    if (!next) return ''
    if (next.text.toLowerCase() === 'on') {
      const constraint = tokens.slice(conflict + 2)
        .findIndex((candidate: any) => candidate.text.toLowerCase() === 'constraint')
      if (constraint < 0) return ''
      const name = tokens[conflict + 2 + constraint + 1]
      return name ? ` ON CONSTRAINT ${this.quoteIdentifier(name.text)}` : ''
    }
    if (next.text !== '(') return ''
    const items: string[] = []
    let depth = 0
    let current: string[] = []
    for (let index = conflict + 1; index < tokens.length; index += 1) {
      const candidate = tokens[index] as any
      if (candidate.text === '(') {
        depth += 1
        if (depth === 1) continue
      }
      if (candidate.text === ')') {
        depth -= 1
        if (depth === 0) {
          if (current.length > 0) items.push(current.join(' '))
          break
        }
      }
      if (depth === 1) {
        if (candidate.text === ',') {
          if (current.length > 0) items.push(current.join(' '))
          current = []
          continue
        }
        current.push(this.quoteIdentifier(candidate.text))
      }
    }
    return items.length > 0 ? ` (${items.join(', ')})` : ''
  }

  /**
   * Print an ON CONFLICT clause.
   * @param body - OnConflictClause body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  onConflict(body: any, indent: string): string[] {
    const target = this.onConflictTarget(body)
    const action = body.action === 'ONCONFLICT_NOTHING' ? 'DO NOTHING' : 'DO UPDATE'
    const updates = body.targetList ?? []
    if (updates.length === 0) return [`${indent}ON CONFLICT${target} ${action}`]
    const formatUpdate = (node: any): string => {
      const update = this.tag(node)?.[1]
      if (!update) return ''
      const name = typeof update.location === 'number' && update.location >= 0
        ? this.quoteIdentifier(this.readName(update.location).text)
        : update.name
      return `${name} = ${this.expr(update.val)}`
    }
    if (updates.length === 1) {
      return [`${indent}ON CONFLICT${target} ${action} SET ${formatUpdate(updates[0])}`]
    }
    const lines = [`${indent}ON CONFLICT${target} ${action} SET`]
    updates.forEach((update: any, index: number) => {
      lines.push(`${indent}  ${formatUpdate(update)}${index < updates.length - 1 ? ',' : ''}`)
    })
    return lines
  }

  /**
   * Format a function-like call, splitting long argument lists.
   * @param type - Node type.
   * @param body - Call body.
   * @param indent - Prefix for the call.
   * @returns Formatted lines.
   */
  callLines(type: string, body: any, indent: string): string[] {
    const name = type === 'CoalesceExpr'
      ? 'COALESCE'
      : (body.funcname ?? []).map((part: any) => this.tag(part)?.[1]?.sval ?? '').join('.').toUpperCase()
    const args = body.agg_star ? null : (body.args ?? [])
    const inline = type === 'CoalesceExpr'
      ? `COALESCE(${args.map((arg: any) => this.expr(arg)).join(', ')})`
      : this.funcCall(body)
    if (inline.length + indent.length <= 80 || !args || args.length === 0) return [`${indent}${inline}`]
    const lines = [`${indent}${name}(`]
    args.forEach((arg: any, index: number) => {
      const tagged = this.tag(arg)
      const argLines = tagged?.[0] === 'FuncCall' || tagged?.[0] === 'CoalesceExpr'
        ? this.callLines(tagged[0], tagged[1], `${indent}  `)
        : [`${indent}  ${this.expr(arg)}`]
      if (index < args.length - 1) argLines[argLines.length - 1] = `${argLines[argLines.length - 1]},`
      lines.push(...argLines)
    })
    lines.push(`${indent})`)
    return lines
  }

  /**
   * Parenthesize an operand when SQL precedence would otherwise change.
   * @param node - Operand node.
   * @returns Grouped inline SQL.
   */
  group(node: any): string {
    const text = this.expr(node)
    const type = this.tag(node)?.[0]
    return type === 'A_Expr' || type === 'BoolExpr' ? `(${text})` : text
  }

  /**
   * Print an expression inline.
   * @param node - Expression node.
   * @returns Inline SQL.
   */
  expr(node: any): string {
    const tagged = this.tag(node)
    if (!tagged) return ''
    const [type, body] = tagged
    switch (type) {
      case 'ColumnRef': return this.columnRef(body)
      case 'A_Const': return this.literal(body)
      case 'ParamRef': return this.paramRef(body)
      case 'A_Expr': return this.aExpr(body)
      case 'BoolExpr': {
        if (body.boolop === 'NOT_EXPR') return `NOT (${this.expr(body.args?.[0])})`
        const operator = body.boolop === 'AND_EXPR' ? 'AND' : 'OR'
        return `(${(body.args ?? []).map((arg: any) => this.expr(arg)).join(` ${operator} `)})`
      }
      case 'NullTest':
        return `${this.group(body.arg)} IS ${body.nulltesttype === 'IS_NOT_NULL' ? 'NOT ' : ''}NULL`
      case 'BooleanTest': {
        const negated = body.booltesttype === 'IS_NOT_TRUE' || body.booltesttype === 'IS_NOT_FALSE'
        const expected = body.booltesttype?.includes('FALSE') ? 'FALSE' : 'TRUE'
        return `${this.group(body.arg)} IS ${negated ? 'NOT ' : ''}${expected}`
      }
      case 'TypeCast': {
        const typeName = this.tag(body.typeName)?.[1] ?? body.typeName
        const cast = typeName?.location >= 0 ? this.readTypeName(typeName.location) : this.typeNameText(body.typeName)
        return `${this.group(body.arg)}::${cast}`
      }
      case 'FuncCall': return this.funcCall(body)
      case 'CoalesceExpr':
        return `COALESCE(${(body.args ?? []).map((arg: any) => this.expr(arg)).join(', ')})`
      case 'SubLink': {
        const subselect = body.subselect?.SelectStmt
        if (!subselect) throw new Error('Unsupported SubLink')
        const inner = this.select(subselect, '').join(' ')
        if (body.subLinkType === 'EXISTS_SUBLINK') return `EXISTS (${inner})`
        if (body.subLinkType === 'EXPR_SUBLINK') return `(${inner})`
        if (body.subLinkType === 'ARRAY_SUBLINK') return `ARRAY(${inner})`
        throw new Error(`Unsupported SubLink type: ${body.subLinkType}`)
      }
      case 'CaseExpr': return this.caseInline(body)
      case 'SQLValueFunction': {
        const names: Record<string, string> = {
          SVFOP_CURRENT_CATALOG: 'CURRENT_CATALOG',
          SVFOP_CURRENT_DATE: 'CURRENT_DATE',
          SVFOP_CURRENT_ROLE: 'CURRENT_ROLE',
          SVFOP_CURRENT_SCHEMA: 'CURRENT_SCHEMA',
          SVFOP_CURRENT_TIME: 'CURRENT_TIME',
          SVFOP_CURRENT_TIMESTAMP: 'CURRENT_TIMESTAMP',
          SVFOP_CURRENT_USER: 'CURRENT_USER',
          SVFOP_LOCALTIME: 'LOCALTIME',
          SVFOP_LOCALTIMESTAMP: 'LOCALTIMESTAMP',
          SVFOP_SESSION_USER: 'SESSION_USER',
          SVFOP_SYSTEM_USER: 'SYSTEM_USER',
          SVFOP_USER: 'USER',
        }
        return names[body.op] ?? body.op
      }
      case 'A_Star': return '*'
      case 'String': return body.sval ?? ''
      default: throw new Error(`Unsupported expression: ${type}`)
    }
  }

  /**
   * Print a column reference and preserve quoting.
   * @param body - ColumnRef body.
   * @returns Column text.
   */
  columnRef(body: any): string {
    const fields = body.fields ?? []
    if (body.location >= 0) {
      const name = this.readQualifiedName(body.location, fields.length)
      if (name.text) return name.text
    }
    return fields.map((field: any) => {
      const tagged = this.tag(field)
      return tagged?.[0] === 'A_Star' ? '*' : this.quoteIdentifier(tagged?.[1]?.sval ?? '')
    }).join('.')
  }

  /**
   * Print a literal and preserve its source spelling.
   * @param body - A_Const body.
   * @returns Literal text.
   */
  literal(body: any): string {
    if (body.isnull) return 'NULL'
    if (typeof body.location === 'number' && body.location >= 0) {
      const text = this.readLiteral(body.location)
      if (text) return text
    }
    return this.constant(body)
  }

  /**
   * Print a parameter reference.
   * @param body - ParamRef body.
   * @returns Parameter text.
   */
  paramRef(body: any): string {
    if (typeof body.location === 'number' && body.location >= 0) {
      const parameter = /^\$\d+/u.exec(this.source.slice(body.location))?.[0]
      if (parameter) return parameter
    }
    return `$${body.number}`
  }

  /**
   * Print a function call.
   * @param body - FuncCall body.
   * @returns Function call text.
   */
  funcCall(body: any): string {
    const parts = (body.funcname ?? []).map((part: any) => this.tag(part)?.[1]?.sval ?? '')
    const raw = typeof body.location === 'number' && body.location >= 0
      ? this.readQualifiedName(body.location, parts.length, false).text
      : parts.join('.')
    const name = raw.split('.').map(part => (part.startsWith('"') ? part : part.toUpperCase())).join('.')
    if (body.over || body.agg_filter || body.agg_within_group || body.func_variadic) {
      throw new Error('Unsupported function clause')
    }
    const distinct = body.agg_distinct ? 'DISTINCT ' : ''
    const args = body.agg_star ? '*' : (body.args ?? []).map((arg: any) => this.expr(arg)).join(', ')
    const order = body.agg_order?.length
      ? ` ORDER BY ${body.agg_order.map((item: any) => this.sort(item)).join(', ')}`
      : ''
    return `${name}(${distinct}${args}${order})`
  }

  /**
   * Print an A_Expr node.
   * @param body - A_Expr body.
   * @returns Inline expression.
   */
  aExpr(body: any): string {
    const operator = body.name?.[0]?.String?.sval ?? ''
    if (!operator) return ''
    const left = this.group(body.lexpr)
    const right = (): string => this.group(body.rexpr)
    const items = (): string[] => (this.tag(body.rexpr)?.[1]?.items ?? []).map((item: any) => this.expr(item))
    if (body.kind === 'AEXPR_OP_ANY') return `${left} ${operator} ANY (${right()})`
    if (body.kind === 'AEXPR_OP_ALL') return `${left} ${operator} ALL (${right()})`
    if (body.kind === 'AEXPR_LIKE') return `${left} ${operator === '!~~' ? 'NOT LIKE' : 'LIKE'} ${right()}`
    if (body.kind === 'AEXPR_ILIKE') return `${left} ${operator === '!~~*' ? 'NOT ILIKE' : 'ILIKE'} ${right()}`
    if (body.kind === 'AEXPR_IN') return `${left} ${operator === '<>' ? 'NOT IN' : 'IN'} (${items().join(', ')})`
    if (body.kind === 'AEXPR_BETWEEN' || body.kind === 'AEXPR_NOT_BETWEEN'
      || body.kind === 'AEXPR_BETWEEN_SYM' || body.kind === 'AEXPR_NOT_BETWEEN_SYM') {
      const bounds = items()
      const keyword = body.kind === 'AEXPR_BETWEEN' ? 'BETWEEN'
        : body.kind === 'AEXPR_NOT_BETWEEN' ? 'NOT BETWEEN'
          : body.kind === 'AEXPR_BETWEEN_SYM' ? 'BETWEEN SYMMETRIC' : 'NOT BETWEEN SYMMETRIC'
      return `${left} ${keyword} ${bounds[0]} AND ${bounds[1]}`
    }
    if (body.kind === 'AEXPR_DISTINCT') return `${left} IS DISTINCT FROM ${right()}`
    if (body.kind === 'AEXPR_NOT_DISTINCT') return `${left} IS NOT DISTINCT FROM ${right()}`
    if (body.kind === 'AEXPR_NULLIF') return `NULLIF(${left}, ${right()})`
    return `${left} ${operator} ${right()}`
  }

  /**
   * Print a CASE expression inline.
   * @param body - CaseExpr body.
   * @returns Inline CASE.
   */
  caseInline(body: any): string {
    const head = `CASE${body.arg ? ` ${this.expr(body.arg)}` : ''}`
    const whens = (body.args ?? []).map((node: any) => {
      const clause = this.tag(node)?.[1]
      return clause ? `WHEN ${this.expr(clause.expr)} THEN ${this.expr(clause.result)}` : ''
    }).filter(Boolean)
    const otherwise = body.defresult ? ` ELSE ${this.expr(body.defresult)}` : ''
    return `${head} ${whens.join(' ')}${otherwise} END`
  }

  /**
   * Print a TypeName without a usable source location.
   * @param body - TypeName body.
   * @returns Type text.
   */
  typeNameText(body: any): string {
    const names = (body.names ?? []).map((name: any) => this.tag(name)?.[1]?.sval ?? '')
    return names[names.length - 1] ?? ''
  }

  /**
   * Print a literal without source location.
   * @param body - A_Const body.
   * @returns Inline literal.
   */
  constant(body: any): string {
    if (body.ival) return String(body.ival.ival)
    if (body.fval) return String(body.fval.fval)
    if (body.sval) return `'${body.sval.sval}'`
    if (body.bsval) return `B'${body.bsval.bsval}'`
    if (body.boolval) return body.boolval.boolval ? 'true' : 'false'
    if (body.isnull) return 'NULL'
    return ''
  }
}

/** Prints a PL/pgSQL function body from the parsed PL syntax tree. */
class PlPgSqlPrinter {
  #used = new Set<number>()

  constructor(
    private readonly comments: readonly SqlComment[],
    private readonly functionNode: any,
    private readonly start: number,
    private readonly end: number,
  ) {}

  /**
   * Print the parsed PL/pgSQL function body.
   * @returns Formatted lines.
   */
  print(): string[] {
    const block = this.functionNode.action?.PLpgSQL_stmt_block
    if (!block) return []
    const lines: string[] = []
    const declarations = (this.functionNode.datums ?? [])
      .map((datum: any) => datum.PLpgSQL_var)
      .filter((variable: any) => variable?.lineno && variable.refname && variable.datatype && !variable.isconst)
    if (declarations.length > 0) {
      lines.push('DECLARE')
      for (const variable of declarations) {
        const type = variable.datatype.PLpgSQL_type?.typname ?? ''
        lines.push(`  ${variable.refname} ${String(type).toUpperCase()};`)
      }
    }
    const inner = (block.body ?? []).find((statement: any) => statement.PLpgSQL_stmt_block)?.PLpgSQL_stmt_block
    lines.push(...this.block(inner ?? block, ''))
    return lines
  }

  /**
   * Print one PL/pgSQL block.
   * @param body - PLpgSQL_stmt_block body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  block(body: any, indent: string): string[] {
    const lines = [`${indent}BEGIN`]
    let previousType = ''
    for (const statement of body.body ?? []) {
      const type = Object.keys(statement ?? {})[0] ?? ''
      const statementLines = this.statement(statement, `${indent}  `)
      if (statementLines.length === 0) continue
      if (previousType === 'PLpgSQL_stmt_if' && lines.length > 1) lines.push('')
      lines.push(...this.commentsBefore(statement, `${indent}  `))
      lines.push(...statementLines)
      previousType = type
    }
    const exceptions = body.exceptions?.PLpgSQL_exception_block?.exc_list ?? []
    if (exceptions.length > 0) {
      lines.push(`${indent}EXCEPTION`)
      for (const exception of exceptions) {
        const clause = exception.PLpgSQL_exception
        const conditions = (clause.conditions ?? []).map((condition: any) => (
          condition.PLpgSQL_condition?.condname ?? ''
        )).filter(Boolean).join(' OR ')
        lines.push(`${indent}  WHEN ${conditions} THEN`)
        for (const statement of clause.action ?? []) {
          lines.push(...this.commentsBefore(statement, `${indent}    `))
          lines.push(...this.statement(statement, `${indent}    `))
        }
      }
    }
    lines.push(`${indent}END`)
    return lines
  }

  /**
   * Print one PL/pgSQL statement.
   * @param node - Tagged PL/pgSQL statement.
   * @param indent - Prefix for this statement.
   * @returns Formatted lines.
   */
  statement(node: any, indent: string): string[] {
    const type = Object.keys(node ?? {})[0]
    const body = type ? node[type] : null
    if (!type || !body) return []
    switch (type) {
      case 'PLpgSQL_stmt_if': {
        const lines = [`${indent}IF ${this.expression(body.cond?.PLpgSQL_expr?.query ?? '')} THEN`]
        for (const statement of body.then_body ?? []) {
          lines.push(...this.commentsBefore(statement, `${indent}  `))
          lines.push(...this.statement(statement, `${indent}  `))
        }
        for (const elsif of body.elsif_list ?? []) {
          const clause = elsif.PLpgSQL_if_elsif
          lines.push(`${indent}ELSIF ${this.expression(clause.cond?.PLpgSQL_expr?.query ?? '')} THEN`)
          for (const statement of clause.stmts ?? []) {
            lines.push(...this.commentsBefore(statement, `${indent}  `))
            lines.push(...this.statement(statement, `${indent}  `))
          }
        }
        if (body.else_body?.length) {
          lines.push(`${indent}ELSE`)
          for (const statement of body.else_body) {
            lines.push(...this.commentsBefore(statement, `${indent}  `))
            lines.push(...this.statement(statement, `${indent}  `))
          }
        }
        lines.push(`${indent}END IF;`)
        return lines
      }
      case 'PLpgSQL_stmt_assign': {
        const query = body.expr?.PLpgSQL_expr?.query ?? ''
        const match = /^(.*?)\s*(:=|=)\s*(.*)$/u.exec(query)
        if (!match) return []
        return [`${indent}${this.expression(match[1] ?? '')} ${match[2]} ${this.expression(match[3] ?? '')};`]
      }
      case 'PLpgSQL_stmt_return': {
        if (body.expr?.PLpgSQL_expr?.query) {
          const query = body.expr.PLpgSQL_expr.query
          const parts = query.split(/\s*\|\|\s*/u)
          if (parts.length > 1) {
            const lines = [`${indent}RETURN`]
            parts.forEach((part: string, index: number) => {
              const prefix = index === 0 ? '  ' : '  || '
              lines.push(`${indent}${prefix}${this.expression(part)}${index === parts.length - 1 ? ';' : ''}`)
            })
            return lines
          }
          return [`${indent}RETURN ${this.expression(query)};`]
        }
        if (typeof body.retvarno === 'number') {
          const datum = this.functionNode.datums?.[body.retvarno]
          const name = datum?.PLpgSQL_rec?.refname ?? datum?.PLpgSQL_var?.refname
          if (name) return [`${indent}RETURN ${name.toUpperCase()};`]
        }
        return []
      }
      case 'PLpgSQL_stmt_raise': {
        const levels: Record<number, string> = { 17: 'LOG', 18: 'NOTICE', 19: 'WARNING', 20: 'INFO', 21: 'EXCEPTION' }
        const level = levels[body.elog_level] ?? 'NOTICE'
        return [`${indent}RAISE ${level} '${String(body.message ?? '').replace(/'/gu, "''")}';`]
      }
      case 'PLpgSQL_stmt_execsql': {
        const query = body.sqlstmt?.PLpgSQL_expr?.query ?? ''
        if (!query) return []
        const formatted = formatSQL(query, `${indent}`)
        if (!formatted) return []
        const lines = formatted.split('\n')
        lines[lines.length - 1] = `${lines[lines.length - 1]};`
        return lines
      }
      default:
        return []
    }
  }

  /**
   * Format one PL/pgSQL expression.
   * @param query - Expression SQL.
   * @returns Inline expression.
   */
  expression(query: string): string {
    if (!query.trim()) return ''
    const formatted = formatSQL(`SELECT ${query}`, '', false).trim()
    const expression = formatted.startsWith('SELECT ') ? formatted.slice(7) : formatted
    return expression.replace(/\b(new|old)\b/giu, word => word.toUpperCase())
  }

  /**
   * Emit comments that precede a statement.
   * @param node - Statement node.
   * @param indent - Prefix for the comments.
   * @returns Comment lines.
   */
  commentsBefore(node: any, indent: string): string[] {
    const type = Object.keys(node ?? {})[0]
    const line = type ? node[type]?.lineno : undefined
    if (typeof line !== 'number') return []
    const lines: string[] = []
    for (const comment of this.comments) {
      if (this.#used.has(comment.start)) continue
      if (comment.start < this.start || comment.start > this.end) continue
      if (comment.line <= line) {
        this.#used.add(comment.start)
        lines.push(`${indent}${comment.text.trim()}`)
      }
    }
    return lines
  }
}

export const sqlTemplateFormat: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression): void {
        if (!isSqlTag(node.tag)) return
        const placeholders: { interpolation: string, placeholder: string }[] = []
        let raw = ''
        node.quasi.quasis.forEach((quasi, index) => {
          raw += quasi.value.raw
          if (index < node.quasi.expressions.length) {
            const next = node.quasi.quasis[index + 1] as ESTree.TemplateElement
            const interpolation = `\${${context.sourceCode.text.slice(quasi.range[1], next.range[0])}}`
            const width = Math.max(...interpolation.split('\n').map(line => line.length))
            const placeholder = `\u0001${index}\u0001${'\u0002'.repeat(Math.max(0, width - 3))}`
            placeholders.push({ interpolation, placeholder })
            raw += placeholder
          }
        })
        const lineStart = context.sourceCode.getText().lastIndexOf('\n', node.range[0]) + 1
        const baseIndent = context.sourceCode.text.slice(lineStart).match(/^\s*/u)?.[0] ?? ''
        const rawLines = raw.split('\n')
        const firstLine = rawLines.find(line => line.trim() !== '')
        const rawIndent = firstLine?.match(/^\s*/u)?.[0] ?? ''
        const dedented = rawLines.map(line => (
          line.trim() === '' ? '' : line.startsWith(rawIndent) ? line.slice(rawIndent.length) : line
        )).join('\n')
        const formatted = formatSQL(dedented, `${baseIndent}  `)
        let body = `\n${formatted}\n${baseIndent}`
        placeholders.forEach(({ interpolation, placeholder }) => {
          body = body.replace(placeholder, interpolation)
        })
        const replacement = `\`${body}\``
        if (replacement === context.sourceCode.getText(node.quasi)) return
        context.report({
          fix: fixer => fixer.replaceText(node.quasi, replacement),
          messageId: 'formatSql',
          node,
        })
      },
    }
  },
  meta: {
    docs: {
      description: 'Require canonical formatting for Bun SQL tagged templates.',
    },
    fixable: 'code',
    messages: {
      formatSql: 'SQL template is not in canonical format.',
    },
    schema: [],
    type: 'layout',
  },
}
