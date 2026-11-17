/* eslint-disable @typescript-eslint/no-explicit-any -- AST printer boundary over PostgreSQL nodes. */
import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { loadModule, parsePlPgSQLSync, parseSync, scanSync } from 'libpg-query'
import { concat as docConcat, group as docGroup, hardline as docHardline, join as docJoin, line as docLine, nest as docNest, render as renderDoc, text as docText } from './sqlLayout'

await loadModule()

/** Raised when a nested AST node has no faithful printer. */
class UnsupportedNodeError extends Error {
  constructor(readonly nodeType: string) {
    super(`SQL formatter: unsupported AST node "${nodeType}"`)
  }
}

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
 * Result of formatting one SQL template body.
 */
export interface SqlFormatResult {
  formatted: string,
  unsupported?: string,
}

/**
 * Format one SQL template body through the PostgreSQL AST.
 * @param sql - SQL text with expression placeholders.
 * @param indent - Prefix for every formatted line.
 * @param quoteIdentifiers - Whether emitted identifiers should be quoted.
 * @returns Formatting result, including an unsupported construct when present.
 */
export function formatSQLResult(sql: string, indent = '', quoteIdentifiers = true): SqlFormatResult {
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
    if (!parsed.stmts?.length) return { formatted: '' }
    const comments = sqlComments(safeSql)
    let formatted = parsed.stmts.map((raw: any) => {
      const start = raw.stmt_location ?? 0
      const end = raw.stmt_len === undefined ? safeSql.length : start + raw.stmt_len
      return new LibpgPrinter(safeSql, end, comments, start, quoteIdentifiers).statement(raw.stmt, indent)
    }).join(';\n\n')
    for (const [safe, original] of placeholders) {
      formatted = formatted.replace(new RegExp(safe, 'giu'), original)
    }
    return { formatted }
  } catch (error) {
    const lines = sql.split('\n')
    while (lines.length > 0 && (lines[0] as string).trim() === '') lines.shift()
    while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') lines.pop()
    return {
      formatted: lines.map(line => `${indent}${line}`).join('\n'),
      ...(error instanceof UnsupportedNodeError ? { unsupported: error.nodeType } : {}),
    }
  }
}

/**
 * Format one SQL template body through the PostgreSQL AST.
 * @param sql - SQL text with expression placeholders.
 * @param indent - Prefix for every formatted line.
 * @param quoteIdentifiers - Whether emitted identifiers should be quoted.
 * @returns Formatted SQL text.
 */
export function formatSQL(sql: string, indent = '', quoteIdentifiers = true): string {
  return formatSQLResult(sql, indent, quoteIdentifiers).formatted
}

/** One SQL comment with its absolute location. */
interface SqlComment {
  end: number,
  line: number,
  start: number,
  text: string,
}

const BUILTIN_FUNCTIONS = new Set([
  'abs', 'aclexplode', 'array_agg', 'array_length', 'array_position', 'array_remove', 'array_to_string',
  'avg', 'cardinality', 'cast', 'chr', 'coalesce', 'concat', 'count', 'current_database',
  'current_schema', 'current_schemas', 'current_setting', 'current_user', 'date_part',
  'date_trunc', 'extract', 'format', 'generate_series', 'gen_random_uuid', 'greatest',
  'has_schema_privilege', 'hashtext', 'json_agg', 'json_build_object', 'jsonb_agg', 'jsonb_build_object',
  'jsonb_set', 'least', 'length', 'lower', 'make_interval', 'max', 'md5', 'min', 'now',
  'nullif', 'pg_get_constraintdef', 'pg_get_function_identity_arguments', 'pg_get_functiondef',
  'pg_advisory_xact_lock', 'pg_get_indexdef', 'pg_get_triggerdef', 'pg_get_userbyid', 'position',
  'random', 'regexp_replace', 'round',
  'row_to_json', 'session_user', 'set_config', 'setweight', 'split_part', 'string_agg', 'string_to_array',
  'substring', 'sum', 'to_char', 'to_date', 'to_json', 'to_jsonb', 'to_regclass', 'to_regprocedure',
  'to_timestamp', 'to_tsvector', 'transaction_timestamp', 'trim', 'unaccent', 'unnest',
  'upper', 'user',
])

const ALIAS_STOP_WORDS = new Set([
  'from', 'where', 'group', 'having', 'order', 'limit', 'offset', 'union', 'intersect',
  'except', 'join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'on', 'using',
  'returning', 'set', 'values', 'conflict', 'do', 'for', 'window', 'fetch', 'into', 'select',
  'update', 'delete', 'insert', 'with',
])

/** Prints raw libpg-query statements in the canonical Basis layout. */
class LibpgPrinter {
  #usedComments = new Set<number>()

  /*
   * Node printers keyed by the raw PostgreSQL node tag. A node type without a
   * printer is emitted from source and reported instead of being dropped.
   */
  private readonly statementPrinters = new Map<string, (body: any, indent: string) => string[]>([
    ['SelectStmt', (body, indent) => this.select(body, indent)],
    ['InsertStmt', (body, indent) => this.insert(body, indent)],
    ['ViewStmt', (body, indent) => this.view(body, indent)],
    ['CreateStmt', (body, indent) => this.createTable(body, indent)],
    ['CreateFunctionStmt', (body, indent) => this.createFunction(body, indent)],
    ['DoStmt', (body, indent) => this.doBlock(body, indent)],
    ['UpdateStmt', (body, indent) => this.update(body, indent)],
    ['DeleteStmt', (body, indent) => this.delete(body, indent)],
    ['VariableSetStmt', (body, indent) => this.variableSet(body, indent)],
    ['ConstraintsSetStmt', (body, indent) => [
      `${indent}SET CONSTRAINTS ALL ${body.deferred ? 'DEFERRED' : 'IMMEDIATE'}`,
    ]],
    ['DropStmt', (body, indent) => this.drop(body, indent)],
    ['IndexStmt', (body, indent) => this.index(body, indent)],
    ['VacuumStmt', (body, indent) => this.vacuum(body, indent)],
    ['CreateSeqStmt', (body, indent) => this.createSequence(body, indent)],
    ['AlterTableStmt', (body, indent) => this.alterTable(body, indent)],
    ['CreateSchemaStmt', (body, indent) => this.createSchema(body, indent)],
    ['CreateTrigStmt', (body, indent) => this.createTrigger(body, indent)],
    ['ClosePortalStmt', (body, indent) => this.closePortal(body, indent)],
    ['CreateExtensionStmt', (body, indent) => this.createExtension(body, indent)],
    ['CreatePolicyStmt', (body, indent) => this.createPolicy(body, indent)],
    ['GrantStmt', (body, indent) => this.grant(body, indent)],
    ['RenameStmt', (body, indent) => this.rename(body, indent)],
    ['TransactionStmt', (body, indent) => this.transaction(body, indent)],
    ['VariableShowStmt', (body, indent) => this.variableShow(body, indent)],
  ])

  /* Expression printers keyed by the raw PostgreSQL node tag. */
  private readonly expressionPrinters = new Map<string, (body: any) => string>([
    ['ColumnRef', body => this.columnRef(body)],
    ['A_Const', body => this.literal(body)],
    ['ParamRef', body => this.paramRef(body)],
    ['A_Expr', body => this.aExpr(body)],
    ['BoolExpr', body => {
      if (body.boolop === 'NOT_EXPR') return `NOT (${this.expr(body.args?.[0])})`
      const operator = body.boolop === 'AND_EXPR' ? 'AND' : 'OR'
      return `(${(body.args ?? []).map((arg: any) => this.expr(arg)).join(` ${operator} `)})`
    }],
    ['NullTest', body => `${this.group(body.arg)} IS ${body.nulltesttype === 'IS_NOT_NULL' ? 'NOT ' : ''}NULL`],
    ['BooleanTest', body => {
      const negated = body.booltesttype === 'IS_NOT_TRUE' || body.booltesttype === 'IS_NOT_FALSE'
      const expected = body.booltesttype?.includes('FALSE') ? 'FALSE' : 'TRUE'
      return `${this.group(body.arg)} IS ${negated ? 'NOT ' : ''}${expected}`
    }],
    ['TypeCast', body => {
      const typeName = this.tag(body.typeName)?.[1] ?? body.typeName
      const cast = typeName?.location >= 0 ? this.readTypeName(typeName.location) : this.typeNameText(body.typeName)
      return `${this.group(body.arg)}::${cast}`
    }],
    ['FuncCall', body => this.funcCall(body)],
    ['CoalesceExpr', body => `COALESCE(${(body.args ?? []).map((arg: any) => this.expr(arg)).join(', ')})`],
    ['SubLink', body => {
      const subselect = body.subselect?.SelectStmt
      if (!subselect) return this.unsupportedExpression('SubLink', body)
      const inner = this.select(subselect, '  ')
      const inline = inner.map((line: string) => line.trim()).join(' ')
      const prefix = body.subLinkType === 'EXISTS_SUBLINK'
        ? 'EXISTS '
        : body.subLinkType === 'ARRAY_SUBLINK' ? 'ARRAY' : ''
      if (inline.length + prefix.length + 2 <= 80) return `${prefix}(${inline})`
      if (body.subLinkType === 'EXISTS_SUBLINK') return `EXISTS (\n${inner.join('\n')}\n)`
      if (body.subLinkType === 'EXPR_SUBLINK') return `(\n${inner.join('\n')}\n)`
      if (body.subLinkType === 'ARRAY_SUBLINK') return `ARRAY(\n${inner.join('\n')}\n)`
      return this.unsupportedExpression('SubLink', body)
    }],
    ['CaseExpr', body => this.caseInline(body)],
    ['SQLValueFunction', body => this.sqlValueFunction(body)],
    ['A_Star', () => '*'],
    ['A_ArrayExpr', body => `ARRAY [${(body.elements ?? []).map((item: any) => this.expr(item)).join(', ')}]`],
    ['RowExpr', body => `ROW(${(body.args ?? []).map((item: any) => this.expr(item)).join(', ')})`],
    ['A_Indirection', body => this.indirection(body)],
    ['CollateClause', body => `${this.expr(body.arg)} COLLATE ${this.qualifiedName(body.collname)}`],
    ['MinMaxExpr', body => `${body.op === 'IS_GREATEST' ? 'GREATEST' : 'LEAST'}` +
      `(${(body.args ?? []).map((item: any) => this.expr(item)).join(', ')})`],
    ['NamedArgExpr', body => `${this.quoteIdentifier(body.name)} => ${this.expr(body.arg)}`],
    ['GroupingFunc', body => `GROUPING(${(body.args ?? []).map((item: any) => this.expr(item)).join(', ')})`],
    ['SetToDefault', () => 'DEFAULT'],
    ['Boolean', body => (body.boolval ? 'true' : 'false')],
    ['GroupingSet', body => this.groupingSet(body)],
    ['AccessPriv', body => this.accessPriv(body)],
    ['RoleSpec', body => this.roleSpec(body)],
    ['ObjectWithArgs', body => this.objectWithArgs(body)],
    ['String', body => body.sval ?? ''],
  ])

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
   * Reject a node without a faithful printer.
   * @param type - Raw node tag.
   * @param _args - Unsupported call arguments.
   */
  unsupported(type: string, ..._args: any[]): never {
    void _args
    throw new UnsupportedNodeError(type)
  }

  /**
   * Report an unhandled expression node.
   * @param type - Raw node tag.
   * @param node - Raw node body.
   * @returns Source text for the node.
   */
  unsupportedExpression(type: string, node: any): string {
    return this.unsupported(type, node)
  }

  /**
   * Reject a statement without a faithful printer.
   * @param node - Raw statement node.
   * @param _args - Unsupported call arguments.
   */
  unsupportedStatement(node: any, ..._args: any[]): never {
    void _args
    const tagged = this.tag(node)
    throw new UnsupportedNodeError(tagged?.[0] ?? 'unknown')
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
    if (!node || typeof node !== 'object') return -1
    if (Array.isArray(node)) {
      const locations = node.map((item: any) => this.startLocation(item)).filter((location: number) => location >= 0)
      return locations.length > 0 ? Math.min(...locations) : -1
    }
    if (typeof node.location === 'number' && node.location >= 0) return node.location
    const tagged = this.tag(node)
    if (tagged && typeof tagged[1].location === 'number' && tagged[1].location >= 0) {
      return tagged[1].location
    }
    const body = tagged?.[1] ?? node
    const locations = Object.entries(body)
      .filter(([key]) => key !== 'location')
      .map(([, value]) => this.startLocation(value))
      .filter((location: number) => location >= 0)
    return locations.length > 0 ? Math.min(...locations) : -1
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
   * Format an identifier from source spelling.
   * @param text - Identifier text.
   * @returns Quoted identifier preserving its SQL meaning.
   */
  identifier(text: string): string {
    if (!text) return ''
    if (text.startsWith('"')) return text
    if (/^[A-Z][A-Z0-9_]*$/u.test(text)) return this.quoteIdentifier(text.toLowerCase())
    return this.quoteIdentifier(text)
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
    return candidate ? ` AS ${this.identifier(candidate.text)}` : ` AS ${this.identifier(body.name)}`
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
      lines = this.expr(body.val).split('\n')
      lines[lines.length - 1] = `${lines[lines.length - 1]}${alias}`
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
    const printer = this.statementPrinters.get(tagged[0])
    return printer ? printer(tagged[1], indent) : this.unsupportedStatement(node, indent)
  }

  /**
   * Print a SELECT statement.
   * @param body - SelectStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  select(body: any, indent: string): string[] {
    if (body.withClause) return this.withSelect(body, indent)
    if (body.op && body.op !== 'SETOP_NONE') return this.setOperation(body, indent)
    if (body.valuesLists) return this.values(body.valuesLists, indent)
    const nodes = body.targetList ?? []
    const targets = nodes.map((target: any, index: number) => (
      this.target(target, this.targetLimit(body, nodes, index))
    ))
    const distinctTargets = (body.distinctClause ?? []).filter((item: any) => item && Object.keys(item).length > 0)
    const distinct = distinctTargets.length > 0
      ? `DISTINCT ON (${distinctTargets.map((item: any) => this.expr(item)).join(', ')}) `
      : body.distinctClause?.length ? 'DISTINCT ' : ''
    const targetDocs = targets.map((target: string[], targetIndex: number) => {
      const targetLines = [...target]
      if (targetIndex < targets.length - 1 && targetLines.length > 0) {
        const last = targetLines[targetLines.length - 1] as string
        targetLines[targetLines.length - 1] = last.includes(' --')
          ? last.replace(' --', ', --')
          : `${last},`
      }
      return targetLines.length === 1
        ? docText(targetLines[0] as string)
        : docJoin(docHardline(), targetLines.map(line => docText(line)))
    })
    const firstTarget = targets[0] ?? []
    const forceBreak = targets.some((target: string[]) => (
      target.length > 1 || target.some(line => line.includes('--'))
    ))
    let selectDoc
    if (targets.length === 1) {
      selectDoc = docConcat(
        docText(`SELECT ${distinct}${firstTarget[0] ?? ''}`),
        firstTarget.length > 1
          ? docConcat(docHardline(), docJoin(docHardline(), firstTarget.slice(1).map(line => docText(line))))
          : docText(''),
      )
    } else {
      selectDoc = docConcat(
        docText(`SELECT${distinct ? ` ${distinct.trim()}` : ''}`),
        docGroup(docNest(docConcat(
          docLine(),
          docJoin(forceBreak ? docHardline() : docLine(), targetDocs),
        ))),
      )
    }
    const lines = renderDoc(selectDoc, 100).split('\n').map(line => `${indent}${line}`)
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
    if (body.windowClause?.length) {
      const windows = body.windowClause
        .map((node: any) => this.namedWindow(this.tag(node)?.[1] ?? node)).join(', ')
      lines.push(`${indent}WINDOW ${windows}`)
    }
    if (body.limitCount) lines.push(`${indent}LIMIT ${this.expr(body.limitCount)}`)
    if (body.limitOffset) lines.push(`${indent}OFFSET ${this.expr(body.limitOffset)}`)
    if (body.lockingClause?.length) {
      for (const node of body.lockingClause) {
        const lock = this.tag(node)?.[1]
        const strength: Record<string, string> = {
          LCS_FORKEYSHARE: 'FOR KEY SHARE',
          LCS_FORNOKEYUPDATE: 'FOR NO KEY UPDATE',
          LCS_FORSHARE: 'FOR SHARE',
          LCS_FORUPDATE: 'FOR UPDATE',
        }
        const wait = lock?.waitPolicy === 'LockWaitSkip'
          ? ' SKIP LOCKED'
          : lock?.waitPolicy === 'LockWaitError' ? ' NOWAIT' : ''
        lines.push(`${indent}${strength[lock?.strength] ?? this.unsupported('LockingClause', lock)}${wait}`)
      }
    }
    return lines
  }

  /**
   * Format a named window definition.
   * @param body - WindowDef body.
   * @returns Window definition.
   */
  windowDef(body: any): string {
    const partition = body.partitionClause?.length
      ? `PARTITION BY ${body.partitionClause.map((node: any) => this.expr(node)).join(', ')}`
      : ''
    const order = body.orderClause?.length
      ? `ORDER BY ${body.orderClause.map((node: any) => this.sort(node)).join(', ')}`
      : ''
    return [partition, order].filter(Boolean).join(' ')
  }

  /**
   * Format a named window declaration.
   * @param body - WindowDef body.
   * @returns Named window declaration.
   */
  namedWindow(body: any): string {
    const definition = this.windowDef(body)
    return `${this.quoteIdentifier(body.name ?? '')} AS (${definition})`
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
      const values = (row?.items ?? []).map((item: any) => this.expr(item))
      const inline = `(${values.join(', ')})`
      const comma = index < rows.length - 1 ? ',' : ''
      if (inline.length > 100 || (row?.items ?? []).some((item: any) => this.tag(item)?.[0] === 'SubLink')) {
        lines.push(`${indent}  (`)
        values.forEach((value: string, valueIndex: number) => {
          lines.push(`${indent}    ${value}${valueIndex < values.length - 1 ? ',' : ''}`)
        })
        lines.push(`${indent}  )${comma}`)
      } else {
        lines.push(`${indent}  ${inline}${comma}`)
      }
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
      const cross = !body.quals && !body.usingClause?.length && !body.isNatural
      const join = `${body.isNatural ? 'NATURAL ' : ''}${cross ? 'CROSS JOIN' : this.joinName(body.jointype)}`
      const left = this.fromItem(body.larg)
      const right = this.fromItem(body.rarg)
      const on = body.quals
        ? this.tag(body.quals)?.[0] === 'BoolExpr'
          ? `\n${this.condition(body.quals, '  ', 'ON').join('\n')}`
          : ` ON ${this.expr(body.quals)}`
        : body.usingClause?.length ? ` USING (${this.identifierList(body.usingClause)})` : ''
      const alias = body.alias
        ? ` ${this.formatAlias(body.alias)}`
        : ''

      return `${left}\n${join} ${right}${on}${alias}`
    }
    if (tagged?.[0] === 'RangeVar') return this.rangeVar(tagged[1])
    if (tagged?.[0] === 'RangeFunction') return this.rangeFunction(tagged[1])
    if (node?.relname) return this.rangeVar(node)
    return this.unsupported(tagged?.[0] ?? 'FROM item', node)
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
   * Format a table alias.
   * @param body - Alias body.
   * @returns Alias text.
   */
  formatAlias(body: any): string {
    const columns = body.colnames?.length ? ` (${this.identifierList(body.colnames)})` : ''
    return `AS ${this.identifier(body.aliasname)}${columns}`
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
    if (!candidate) return `${relation.text} ${this.identifier(body.alias.aliasname)}`
    return `${relation.text}${asIndex >= 0 ? ' AS' : ''} ${this.identifier(candidate.text)}`
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
    const aliases = body.aliases?.length ? ` (${this.identifierList(body.aliases)})` : ''
    const options = body.options?.length
      ? ` WITH (${body.options.map((node: any) => this.defElem(node)).join(', ')})`
      : ''
    const lines = [
      `${indent}CREATE ${replace}VIEW ${relation}${aliases}${options} AS (`,
      ...this.lines(body.query, `${indent}  `),
      `${indent})`,
    ]
    const check: Record<string, string> = {
      CASCADED_CHECK_OPTION: ' WITH CASCADED CHECK OPTION',
      LOCAL_CHECK_OPTION: ' WITH LOCAL CHECK OPTION',
      NO_CHECK_OPTION: '',
    }
    lines[lines.length - 1] = `${lines[lines.length - 1]}${check[body.withCheckOption] ?? ''}`
    return lines
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
    lines.push(...this.returningLines(body, indent))
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
    const persistence = body.relation?.relpersistence === 't' ? 'TEMPORARY ' : ''
    const partitionParent = body.partbound && body.inhRelations?.length
      ? this.relationName(this.tag(body.inhRelations[0])?.[1] ?? body.inhRelations[0])
      : null
    const elements = body.tableElts ?? []
    const header = `${indent}CREATE ${persistence}TABLE ${body.if_not_exists ? 'IF NOT EXISTS ' : ''}${relation}` +
      (partitionParent ? ` PARTITION OF ${partitionParent}` : '')
    const lines: string[] = []
    if (elements.length > 0 || !partitionParent) {
      lines.push(`${header} (`)
      elements.forEach((node: any, index: number) => {
        const tagged = this.tag(node)
        const text = this.tableElement(node, tagged)
        lines.push(`${indent}  ${text}${index < elements.length - 1 ? ',' : ''}`)
      })
      lines.push(`${indent})`)
    } else {
      lines.push(header)
    }
    const tail = lines[lines.length - 1] as string
    if (body.inhRelations?.length && !partitionParent) {
      const parents = body.inhRelations.map((node: any) => this.relationName(this.tag(node)?.[1] ?? node))
      lines[lines.length - 1] = `${tail} INHERITS (${parents.join(', ')})`
    }
    if (body.partspec) {
      const strategy = this.partitionStrategy(body.partspec.strategy)
      lines.push(`${indent}PARTITION BY ${strategy} (${this.partitionElems(body.partspec.partParams)})`)
    }
    if (body.partbound) lines.push(`${indent}FOR VALUES ${this.partitionBound(body.partbound)}`)
    if (body.accessMethod) lines.push(`${indent}USING ${body.accessMethod}`)
    if (body.options?.length) {
      lines.push(`${indent}WITH (${body.options.map((node: any) => this.defElem(node)).join(', ')})`)
    }
    if (body.tablespacename) lines.push(`${indent}TABLESPACE ${this.quoteIdentifier(body.tablespacename)}`)
    const onCommit: Record<string, string> = {
      ONCOMMIT_DELETE_ROWS: 'ON COMMIT DELETE ROWS',
      ONCOMMIT_DROP: 'ON COMMIT DROP',
      ONCOMMIT_PRESERVE_ROWS: 'ON COMMIT PRESERVE ROWS',
    }
    if (onCommit[body.oncommit]) lines.push(`${indent}${onCommit[body.oncommit]}`)
    return lines
  }

  /**
   * Format one CREATE TABLE element.
   * @param node - Raw table element.
   * @param tagged - Tagged element.
   * @returns Element text.
   */
  tableElement(node: any, tagged: [string, any] | null): string {
    if (tagged?.[0] === 'ColumnDef') return this.columnDef(tagged[1])
    if (tagged?.[0] === 'Constraint') return this.tableConstraint(tagged[1])
    return this.unsupported(tagged?.[0] ?? 'unknown', node)
  }

  /**
   * Format a foreign-key action.
   * @param keyword - UPDATE or DELETE.
   * @param action - Raw action code.
   * @param actions - Action names.
   * @returns Action clause, or empty.
   */
  foreignAction(keyword: string, action: string, actions: Record<string, string>): string {
    if (!action || action === 'a') return ''
    return ` ON ${keyword} ${actions[action] ?? action}`
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
    const collate = body.collClause ? `COLLATE ${this.qualifiedName(body.collClause.collname)}` : ''
    const constraints = (body.constraints ?? [])
      .map((node: any) => this.tag(node)?.[1])
      .filter(Boolean)
      .map((constraint: any) => this.columnConstraint(constraint))
      .filter(Boolean)
    return [name, type, collate, ...constraints].filter(Boolean).join(' ')
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
   * Format a qualified node name.
   * @param nodes - String nodes.
   * @returns Quoted qualified name.
   */
  qualifiedName(nodes: readonly any[]): string {
    return (nodes ?? []).map(node => this.quoteIdentifier(this.tag(node)?.[1]?.sval ?? '')).join('.')
  }

  /**
   * Format a partitioning strategy.
   * @param strategy - Raw partition strategy.
   * @returns SQL strategy keyword.
   */
  partitionStrategy(strategy: string): string {
    return strategy === 'PARTITION_STRATEGY_LIST' ? 'LIST'
      : strategy === 'PARTITION_STRATEGY_HASH' ? 'HASH' : 'RANGE'
  }

  /**
   * Format partition key expressions.
   * @param nodes - PartitionElem nodes.
   * @returns Comma-separated partition keys.
   */
  partitionElems(nodes: readonly any[]): string {
    return (nodes ?? []).map((node: any) => {
      const body = this.tag(node)?.[1]
      if (!body) return this.expr(node)
      const value = body.name ? this.quoteIdentifier(body.name) : this.expr(body.expr)
      const collate = body.collation ? ` COLLATE ${this.identifierList(body.collation)}` : ''
      const opclass = body.opclass ? ` ${body.opclass}` : ''
      return `${value}${collate}${opclass}`
    }).join(', ')
  }

  /**
   * Format a partition bound.
   * @param body - PartitionBoundSpec body.
   * @returns Bound expression without the FOR VALUES prefix.
   */
  partitionBound(body: any): string {
    if (body.is_default) return 'DEFAULT'
    const values = (nodes: readonly any[]) => (nodes ?? []).map((node: any) => this.expr(node)).join(', ')
    if (body.strategy === 'h') return `WITH (modulus ${body.modulus}, remainder ${body.remainder ?? 0})`
    if (body.strategy === 'l') return `IN (${values(body.listdatums)})`
    return `FROM (${values(body.lowerdatums)}) TO (${values(body.upperdatums)})`
  }

  /**
   * Format a DefElem option.
   * @param node - DefElem node.
   * @returns Option text.
   */
  defElem(node: any): string {
    const body = this.tag(node)?.[1]
    if (!body) return this.expr(node)
    const name = this.quoteIdentifier(body.defname)
    if (body.arg === undefined || body.arg === null) return name
    const value = this.tag(body.arg)?.[1]
    const type = this.tag(body.arg)?.[0]
    if (type === 'String') return `${name} = '${String(value.sval ?? '').replace(/'/gu, "''")}'`
    if (type === 'Integer') return `${name} = ${value.ival}`
    if (type === 'Float') return `${name} = ${value.fval}`
    if (type === 'A_Const') return `${name} = ${this.literal(value)}`
    if (type === 'Boolean') return `${name} = ${value.boolval ? 'true' : 'false'}`
    return `${name} = ${this.expr(body.arg)}`
  }

  /**
   * Format a table or column constraint.
   * @param body - Constraint body.
   * @param tableLevel - Whether this is a table constraint.
   * @returns Constraint text.
   */
  constraintText(body: any, tableLevel: boolean): string {
    const name = body.conname ? `CONSTRAINT ${this.quoteIdentifier(body.conname)} ` : ''
    const keys = this.identifierList(body.keys ?? [])
    let text: string
    switch (body.contype) {
      case 'CONSTR_PRIMARY': text = tableLevel ? `PRIMARY KEY (${keys})` : 'PRIMARY KEY'; break
      case 'CONSTR_NOTNULL': text = 'NOT NULL'; break
      case 'CONSTR_NULL': text = 'NULL'; break
      case 'CONSTR_DEFAULT': text = `DEFAULT ${this.expr(body.raw_expr)}`; break
      case 'CONSTR_FOREIGN': {
        const columns = this.identifierList(body.fk_attrs ?? [])
        const references = this.identifierList(body.pk_attrs ?? [])
        const actions: Record<string, string> = {
          a: 'NO ACTION', c: 'CASCADE', d: 'SET DEFAULT', n: 'SET NULL', r: 'RESTRICT',
        }
        const match = body.fk_matchtype === 'f'
          ? ' MATCH FULL'
          : body.fk_matchtype === 'p' ? ' MATCH PARTIAL' : ''
        const update = this.foreignAction('UPDATE', body.fk_upd_action, actions)
        const del = this.foreignAction('DELETE', body.fk_del_action, actions)
        text = `${tableLevel ? `FOREIGN KEY (${columns}) ` : ''}REFERENCES ${this.relationName(body.pktable)}` +
          `${references ? ` (${references})` : ''}${match}${update}${del}`
        break
      }
      case 'CONSTR_UNIQUE': {
        const distinct = body.nulls_not_distinct ? ' NULLS NOT DISTINCT' : ''
        text = `UNIQUE${distinct}${tableLevel ? ` (${keys})` : ''}`
        break
      }
      case 'CONSTR_CHECK': text = `CHECK (${this.expr(body.raw_expr)})`; break
      case 'CONSTR_IDENTITY': {
        const when = body.generated_when === 'd' ? 'BY DEFAULT' : 'ALWAYS'
        const options = body.options?.length
          ? ` (${body.options.map((node: any) => this.defElem(node)).join(', ')})`
          : ''
        text = `GENERATED ${when} AS IDENTITY${options}`
        break
      }
      case 'CONSTR_GENERATED': {
        const when = body.generated_when === 'd' ? 'BY DEFAULT' : 'ALWAYS'
        const kind = body.generated_kind === 'v' ? 'VIRTUAL' : 'STORED'
        text = `GENERATED ${when} AS (${this.expr(body.raw_expr)}) ${kind}`
        break
      }
      case 'CONSTR_EXCLUSION': {
        const method = body.access_method ? ` USING ${body.access_method}` : ''
        const elements = (body.exclusions ?? []).map((node: any) => this.tag(node)?.[1]?.name ?? '').join(', ')
        text = `EXCLUDE${method} (${elements})`
        break
      }
      default: text = this.unsupported(body.contype ?? 'Constraint', body)
    }
    const suffix: string[] = []
    if (body.deferrable) suffix.push('DEFERRABLE')
    if (body.initdeferred) suffix.push('INITIALLY DEFERRED')
    if (body.is_no_inherit) suffix.push('NO INHERIT')
    if (body.is_enforced === false) suffix.push('NOT ENFORCED')
    if (body.initially_valid === false) suffix.push('NOT VALID')
    if (body.indexname) suffix.push(`USING INDEX ${this.quoteIdentifier(body.indexname)}`)
    if (body.indexspace) suffix.push(`USING INDEX TABLESPACE ${this.quoteIdentifier(body.indexspace)}`)
    return `${name}${text}${suffix.length ? ` ${suffix.join(' ')}` : ''}`
  }

  /**
   * Format a column constraint.
   * @param body - Constraint body.
   * @returns Constraint text.
   */
  columnConstraint(body: any): string {
    return this.constraintText(body, false)
  }

  /**
   * Format a table-level constraint.
   * @param body - Constraint body.
   * @returns Constraint text.
   */
  tableConstraint(body: any): string {
    return this.constraintText(body, true)
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
    const parameters = this.parameterList(body.parameters)
    const options = (body.options ?? [])
      .map((node: any) => this.tag(node)?.[1])
      .filter((option: any) => option && option.defname !== 'as' && option.defname !== 'language')
      .map((option: any) => this.functionOption(option))
      .filter(Boolean)
    const header = `${indent}CREATE ${body.replace ? 'OR REPLACE ' : ''}FUNCTION ${name}(${parameters})` +
      ` RETURNS ${returnType}`
    const optionLines = options.length > 0
      ? [`${indent}  ${options.join(`\n${indent}  `)}`]
      : []
    const head = options.length > 0 ? header : `${header} AS $$`
    const bodyText = this.optionBody(body.options)
    const terminated = this.source[this.end] === ';' || this.source.slice(this.start, this.end).trimEnd().endsWith(';')
    if (language.toLowerCase() === 'plpgsql') {
      const parsed = parsePlPgSQLSync(this.source.slice(this.start, this.end)) as any
      const func = parsed.plpgsql_funcs?.[0]?.PLpgSQL_function
      const lines = func ? new PlPgSqlPrinter(this.plBodyComments(bodyText), func, this.start, this.end).print() : []
      const as = options.length > 0 ? [`${indent}AS $$`] : []
      return [head, ...optionLines, ...as, ...lines, `${indent}$$ LANGUAGE ${language}${terminated ? ';' : ''}`]
    }
    const bodyLines = bodyText.trim()
      ? bodyText.trim().split('\n').map(line => `${indent}  ${line.trim()}`)
      : []
    const as = options.length > 0 ? [`${indent}AS $$`] : []
    return [head, ...optionLines, ...as, ...bodyLines, `${indent}$$ LANGUAGE ${language}${terminated ? ';' : ''}`]
  }

  /**
   * Format a CREATE FUNCTION option.
   * @param option - DefElem body.
   * @returns SQL option text.
   */
  functionOption(option: any): string {
    const value = this.tag(option.arg)?.[1]
    const type = this.tag(option.arg)?.[0]
    switch (option.defname) {
      case 'volatility': return String(value?.sval ?? '').toUpperCase()
      case 'security': return value?.boolval ? 'SECURITY DEFINER' : 'SECURITY INVOKER'
      case 'strict': return value?.boolval ? 'STRICT' : 'CALLED ON NULL INPUT'
      case 'parallel': return `PARALLEL ${String(value?.sval ?? '').toUpperCase()}`
      case 'cost': return `COST ${value?.ival ?? 0}`
      case 'rows': return `ROWS ${value?.ival ?? 0}`
      case 'support': return `SUPPORT ${String(value?.sval ?? '')}`
      case 'leakproof': return value?.boolval ? 'LEAKPROOF' : 'NOT LEAKPROOF'
      case 'window': return 'WINDOW'
      case 'set': {
        const set = this.tag(option.arg)?.[1]
        const args = (set?.args ?? []).map((arg: any) => this.expr(arg)).join(', ')
        return `SET ${set?.name ?? ''}${args ? ` TO ${args}` : ''}`
      }
      default: return type ? this.defElem({ DefElem: option }) : option.defname
    }
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
   * Format a CREATE FUNCTION parameter list.
   * @param parameters - FunctionParameter nodes.
   * @returns Comma-separated parameters.
   */
  parameterList(parameters: readonly any[]): string {
    return (parameters ?? []).map((node: any) => {
      const parameter = this.tag(node)?.[1]
      if (!parameter) return ''
      const modes: Record<string, string> = {
        FUNC_PARAM_INOUT: 'INOUT ',
        FUNC_PARAM_OUT: 'OUT ',
        FUNC_PARAM_TABLE: 'TABLE ',
        FUNC_PARAM_VARIADIC: 'VARIADIC ',
      }
      const mode = modes[parameter.mode] ?? ''
      const name = parameter.name ? `${this.quoteIdentifier(parameter.name)} ` : ''
      const type = this.formatTypeName(parameter.argType)
      const defaultExpr = parameter.defexpr ? ` DEFAULT ${this.expr(parameter.defexpr)}` : ''
      return `${mode}${name}${type}${defaultExpr}`
    }).filter(Boolean).join(', ')
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
   * Format a RETURNING clause.
   * @param body - Statement body.
   * @param indent - Prefix for this block.
   * @returns Returning line, or empty.
   */
  returningLines(body: any, indent: string): string[] {
    const returningList = body.returningClause?.exprs ?? body.returningList ?? []
    if (!returningList.length) return []
    const values = returningList.map((node: any, index: number) => {
      const next = returningList[index + 1]
      const limit = next ? this.startLocation(next) : this.end
      return this.target(node, limit < 0 ? this.end : limit).join(' ')
    })
    return [`${indent}RETURNING ${values.join(', ')}`]
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
    const lines = [
      ...(body.withClause ? this.withClauseLines(body.withClause, indent) : []),
      `${indent}UPDATE ${relation} SET ${updates.join(', ')}`,
    ]
    if (body.fromClause?.length) lines.push(...this.from(body.fromClause, indent))
    if (body.whereClause) lines.push(...this.condition(body.whereClause, indent, 'WHERE'))
    lines.push(...this.returningLines(body, indent))
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
    const lines = [
      ...(body.withClause ? this.withClauseLines(body.withClause, indent) : []),
      `${indent}DELETE FROM ${relation}`,
    ]
    if (body.usingClause?.length) {
      const using = body.usingClause.map((item: any) => this.fromItem(item)).join(', ')
      lines.push(`${indent}USING ${using}`)
    }
    if (body.whereClause) lines.push(...this.condition(body.whereClause, indent, 'WHERE'))
    lines.push(...this.returningLines(body, indent))
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
      OBJECT_FUNCTION: 'FUNCTION',
      OBJECT_INDEX: 'INDEX',
      OBJECT_MATVIEW: 'MATERIALIZED VIEW',
      OBJECT_PROCEDURE: 'PROCEDURE',
      OBJECT_ROUTINE: 'ROUTINE',
      OBJECT_SCHEMA: 'SCHEMA',
      OBJECT_SEQUENCE: 'SEQUENCE',
      OBJECT_TABLE: 'TABLE',
      OBJECT_TRIGGER: 'TRIGGER',
      OBJECT_VIEW: 'VIEW',
    }
    const names = (body.objects ?? []).map((object: any) => {
      const value = this.tag(object)?.[1]
      if (value?.items) return this.identifierList(value.items)
      if (value?.objname) return this.objectWithArgs(value)
      return ''
    }).filter(Boolean).join(', ')
    const type = types[body.removeType]
    if (!type) return [this.unsupported(`DROP ${body.removeType}`, body)]
    const ifExists = body.missing_ok ? ' IF EXISTS' : ''
    const behavior = body.behavior === 'DROP_CASCADE' ? ' CASCADE' : ''
    return [`${indent}DROP ${type}${ifExists} ${names}${behavior}`]
  }

  /**
   * Format a CREATE INDEX statement.
   * @param body - IndexStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  index(body: any, indent: string): string[] {
    const params = (body.indexParams ?? [])
      .map((node: any) => this.indexElem(this.tag(node)?.[1] ?? node)).filter(Boolean)
    const unique = body.unique ? 'UNIQUE ' : ''
    const exists = body.if_not_exists ? 'IF NOT EXISTS ' : ''
    const nulls = body.nulls_not_distinct ? ' NULLS NOT DISTINCT' : ''
    const included = (body.indexIncludingParams ?? [])
      .map((node: any) => this.indexElem(this.tag(node)?.[1] ?? node)).join(', ')
    const include = included ? ` INCLUDE (${included})` : ''
    const options = body.options?.length
      ? ` WITH (${body.options.map((node: any) => this.defElem(node)).join(', ')})`
      : ''
    const space = body.tableSpace ? ` TABLESPACE ${this.quoteIdentifier(body.tableSpace)}` : ''
    const where = body.whereClause ? ` WHERE ${this.expr(body.whereClause)}` : ''
    return [
      `${indent}CREATE ${unique}INDEX ${exists}${this.quoteIdentifier(body.idxname)}` +
        ` ON ${this.relationName(body.relation)}` +
        `${body.accessMethod ? ` USING ${body.accessMethod}` : ''}(${params.join(', ')})` +
        `${include}${nulls}${options}${space}${where}`,
    ]
  }

  /**
   * Format one index element.
   * @param body - IndexElem body.
   * @returns Index element text.
   */
  indexElem(body: any): string {
    const value = body.expr ? `(${this.expr(body.expr)})` : this.quoteIdentifier(body.name ?? '')
    const collate = body.collation?.length ? ` COLLATE ${this.identifierList(body.collation)}` : ''
    const opclass = (body.opclass ?? []).map((part: any) => this.tag(part)?.[1]?.sval ?? '').filter(Boolean)
    const op = opclass.length ? ` ${opclass.join(' ')}` : ''
    const direction = body.ordering === 'SORTBY_DESC' ? ' DESC' : body.ordering === 'SORTBY_ASC' ? ' ASC' : ''
    const nulls = body.nulls_ordering === 'SORTBY_NULLS_FIRST'
      ? ' NULLS FIRST'
      : body.nulls_ordering === 'SORTBY_NULLS_LAST' ? ' NULLS LAST' : ''
    return `${value}${collate}${op}${direction}${nulls}`
  }

  /**
   * Format an ANALYZE or VACUUM statement.
   * @param body - VacuumStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  vacuum(body: any, indent: string): string[] {
    const command = body.is_vacuumcmd ? 'VACUUM' : 'ANALYZE'
    const relations = (body.rels ?? []).map((node: any) => (
      this.relationName(this.tag(node)?.[1]?.relation)
    )).filter(Boolean)
    return [`${indent}${command}${relations.length ? ` ${relations.join(', ')}` : ''}`]
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
    const commands = (body.cmds ?? []).map((node: any) => this.alterCommand(this.tag(node)?.[1], node))
    return [`${indent}ALTER TABLE ${this.relationName(body.relation)} ${commands.join(`,${'\n'}${indent}`)}`]
  }

  /**
   * Format one ALTER TABLE command.
   * @param body - AlterTableCmd body.
   * @param node - The original raw command node.
   * @returns Command text.
   */
  alterCommand(body: any, node: any): string {
    if (!body) return this.unsupported('ALTER TABLE command', node)
    const behavior = body.behavior === 'DROP_CASCADE' ? ' CASCADE' : ''
    const missing = body.missing_ok ? ' IF EXISTS' : ''
    const name = body.name ? this.quoteIdentifier(body.name) : ''
    const def = this.tag(body.def)?.[1]
    switch (body.subtype) {
      case 'AT_AddColumn':
        return `ADD COLUMN ${def ? this.columnDef(def) : ''}`
      case 'AT_DropColumn':
        return `DROP COLUMN${missing} ${name}${behavior}`
      case 'AT_AlterColumnType': {
        if (!def) return this.unsupported('ALTER COLUMN TYPE', node)
        const type = this.formatTypeName(def.typeName)
        const collate = def.collClause ? ` COLLATE ${this.qualifiedName(def.collClause.collname)}` : ''
        const using = def.raw_default ? ` USING ${this.expr(def.raw_default)}` : ''
        return `ALTER COLUMN ${name} TYPE ${type}${collate}${using}`
      }
      case 'AT_AddConstraint':
        return `ADD ${def ? this.constraintText(def, true) : ''}`
      case 'AT_DropConstraint':
        return `DROP CONSTRAINT${missing} ${name}${behavior}`
      case 'AT_ColumnDefault':
        return body.def
          ? `ALTER COLUMN ${name} SET DEFAULT ${this.expr(body.def)}`
          : `ALTER COLUMN ${name} DROP DEFAULT`
      case 'AT_SetNotNull':
        return `ALTER COLUMN ${name} SET NOT NULL`
      case 'AT_DropNotNull':
        return `ALTER COLUMN ${name} DROP NOT NULL`
      case 'AT_SetStatistics':
        return `ALTER COLUMN ${name} SET STATISTICS ${def?.Integer?.ival ?? '0'}`
      case 'AT_SetRelOptions':
        return `SET (${(def?.List?.items ?? []).map((item: any) => this.defElem(item)).join(', ')})`
      case 'AT_ResetRelOptions':
        return `RESET (${(def?.List?.items ?? []).map((item: any) => this.defElem(item)).join(', ')})`
      case 'AT_EnableRowSecurity': return 'ENABLE ROW LEVEL SECURITY'
      case 'AT_DisableRowSecurity': return 'DISABLE ROW LEVEL SECURITY'
      case 'AT_ForceRowSecurity': return 'FORCE ROW LEVEL SECURITY'
      case 'AT_NoForceRowSecurity': return 'NO FORCE ROW LEVEL SECURITY'
      case 'AT_EnableTrig': return `ENABLE TRIGGER ${name}`
      case 'AT_DisableTrig': return `DISABLE TRIGGER ${name}`
      case 'AT_EnableAlwaysTrig': return `ENABLE ALWAYS TRIGGER ${name}`
      case 'AT_EnableReplicaTrig': return `ENABLE REPLICA TRIGGER ${name}`
      case 'AT_SetTableSpace': return `SET TABLESPACE ${this.quoteIdentifier(body.name)}`
      case 'AT_ClusterOn': return `CLUSTER ON ${name}`
      case 'AT_DropOids': return 'SET WITHOUT OIDS'
      case 'AT_SetLogged': return 'SET LOGGED'
      case 'AT_SetUnLogged': return 'SET UNLOGGED'
      case 'AT_ChangeOwner': return `OWNER TO ${name}`
      default: return this.unsupported(`ALTER TABLE ${body.subtype}`, node)
    }
  }

  /**
   * Format a CLOSE statement.
   * @param body - ClosePortalStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  closePortal(body: any, indent: string): string[] {
    return [`${indent}CLOSE ${body.portalname ? this.quoteIdentifier(body.portalname) : 'ALL'}`]
  }

  /**
   * Format a CREATE EXTENSION statement.
   * @param body - CreateExtensionStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  createExtension(body: any, indent: string): string[] {
    const options = (body.options ?? []).map((node: any) => {
      const option = this.tag(node)?.[1]
      if (!option) return ''
      const value = this.tag(option.arg)?.[1]
      return option.defname === 'schema'
        ? `SCHEMA ${this.quoteIdentifier(value?.sval ?? '')}`
        : `${option.defname.toUpperCase()} ${value?.sval ?? ''}`
    }).filter(Boolean)
    return [
      `${indent}CREATE EXTENSION ${body.if_not_exists ? 'IF NOT EXISTS ' : ''}${this.quoteIdentifier(body.extname)}` +
        `${options.length ? ` WITH ${options.join(' ')}` : ''}`,
    ]
  }

  /**
   * Format a CREATE POLICY statement.
   * @param body - CreatePolicyStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  createPolicy(body: any, indent: string): string[] {
    const roles = (body.roles ?? []).map((node: any) => this.roleSpec(this.tag(node)?.[1] ?? node)).join(', ')
    const lines = [
      `${indent}CREATE POLICY ${this.quoteIdentifier(body.policy_name)} ON ${this.relationName(body.table)}`,
      `${indent}  AS ${body.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'}`,
      `${indent}  FOR ${String(body.cmd_name ?? 'all').toUpperCase()}`,
      `${indent}  TO ${roles || 'PUBLIC'}`,
    ]
    if (body.qual) lines.push(`${indent}  USING (${this.expr(body.qual)})`)
    if (body.with_check) lines.push(`${indent}  WITH CHECK (${this.expr(body.with_check)})`)
    return lines
  }

  /**
   * Format a GRANT or REVOKE statement.
   * @param body - GrantStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  grant(body: any, indent: string): string[] {
    const command = body.is_grant ? 'GRANT' : 'REVOKE'
    const privileges = (body.privileges ?? []).length > 0
      ? body.privileges.map((node: any) => this.accessPriv(this.tag(node)?.[1] ?? node)).join(', ')
      : 'ALL'
    const objectType = this.objectType(body.objtype)
    const objects = (body.objects ?? []).map((node: any) => this.grantObject(node)).join(', ')
    const plural = objectType === 'TABLE' ? 'TABLES'
      : objectType === 'SEQUENCE' ? 'SEQUENCES'
        : objectType === 'FUNCTION' ? 'FUNCTIONS' : objectType
    const target = body.targtype === 'ACL_TARGET_ALL_IN_SCHEMA'
      ? `ALL ${plural} IN SCHEMA ${objects}`
      : body.targtype === 'ACL_TARGET_DEFAULTS' ? 'DEFAULT PRIVILEGES'
        : `${objectType} ${objects}`
    const grantees = (body.grantees ?? []).map((node: any) => this.roleSpec(this.tag(node)?.[1] ?? node)).join(', ')
    const behavior = body.is_grant ? '' : body.behavior === 'DROP_CASCADE' ? ' CASCADE' : ''
    return [`${indent}${command} ${privileges} ON ${target} ${body.is_grant ? 'TO' : 'FROM'} ${grantees}${behavior}`]
  }

  /**
   * Format a grant object.
   * @param node - Grant object.
   * @returns Object text.
   */
  grantObject(node: any): string {
    const tagged = this.tag(node)
    if (tagged?.[0] === 'ObjectWithArgs') return this.objectWithArgs(tagged[1])
    return this.qualifiedName([node]) || this.expr(node)
  }

  /**
   * Format a POSTGRES object type keyword.
   * @param type - ObjectType enum.
   * @returns SQL object type.
   */
  objectType(type: string): string {
    if (type === 'OBJECT_TABLE') return 'TABLE'
    if (type === 'OBJECT_SEQUENCE') return 'SEQUENCE'
    if (type === 'OBJECT_SCHEMA') return 'SCHEMA'
    if (type === 'OBJECT_FUNCTION') return 'FUNCTION'
    if (type === 'OBJECT_DATABASE') return 'DATABASE'
    if (type === 'OBJECT_DOMAIN') return 'DOMAIN'
    if (type === 'OBJECT_TYPE') return 'TYPE'
    return type?.replace(/^OBJECT_/u, '') ?? ''
  }

  /**
   * Format a role specification.
   * @param body - RoleSpec body.
   * @returns Role text.
   */
  roleSpec(body: any): string {
    if (body.roletype === 'ROLESPEC_PUBLIC') return 'PUBLIC'
    if (body.roletype === 'ROLESPEC_CURRENT_USER') return 'CURRENT_USER'
    if (body.roletype === 'ROLESPEC_SESSION_USER') return 'SESSION_USER'
    if (body.roletype === 'ROLESPEC_CURRENT_ROLE') return 'CURRENT_ROLE'
    return this.quoteIdentifier(body.rolename ?? '')
  }

  /**
   * Format an access privilege.
   * @param body - AccessPriv body.
   * @returns Privilege text.
   */
  accessPriv(body: any): string {
    const columns = body.cols?.length ? ` (${this.identifierList(body.cols)})` : ''
    return `${String(body.priv_name ?? 'ALL').toUpperCase()}${columns}`
  }

  /**
   * Format a function or object name with arguments.
   * @param body - ObjectWithArgs body.
   * @returns Object text.
   */
  objectWithArgs(body: any): string {
    const name = this.qualifiedName(body.objname ?? [])
    const args = (body.objargs ?? []).map((node: any) => this.formatTypeName(this.tag(node)?.[1] ?? node)).join(', ')
    return `${name}(${args})`
  }

  /**
   * Format a grouping set.
   * @param body - GroupingSet body.
   * @returns Grouping set text.
   */
  groupingSet(body: any): string {
    const content = (body.content ?? []).map((node: any) => this.expr(node))
    if (body.kind === 'GROUPING_SET_EMPTY') return '()'
    if (body.kind === 'GROUPING_SET_ROLLUP') return `ROLLUP (${content.join(', ')})`
    if (body.kind === 'GROUPING_SET_CUBE') return `CUBE (${content.join(', ')})`
    return `GROUPING SETS (${content.join(', ')})`
  }

  /**
   * Format a RENAME statement.
   * @param body - RenameStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  rename(body: any, indent: string): string[] {
    return [
      `${indent}ALTER ${this.objectType(body.renameType)} ${this.relationName(body.relation)}` +
        ` RENAME TO ${this.quoteIdentifier(body.newname)}`,
    ]
  }

  /**
   * Format a transaction-control statement.
   * @param body - TransactionStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  transaction(body: any, indent: string): string[] {
    const kinds: Record<string, string> = {
      TRANS_STMT_BEGIN: 'BEGIN',
      TRANS_STMT_COMMIT: 'COMMIT',
      TRANS_STMT_COMMIT_PREPARED: 'COMMIT PREPARED',
      TRANS_STMT_PREPARE: 'PREPARE TRANSACTION',
      TRANS_STMT_RELEASE: 'RELEASE',
      TRANS_STMT_ROLLBACK: 'ROLLBACK',
      TRANS_STMT_ROLLBACK_PREPARED: 'ROLLBACK PREPARED',
      TRANS_STMT_ROLLBACK_TO: 'ROLLBACK TO',
      TRANS_STMT_SAVEPOINT: 'SAVEPOINT',
    }
    const keyword = kinds[body.kind] ?? body.kind
    return [`${indent}${keyword}${body.savepoint_name ? ` ${this.quoteIdentifier(body.savepoint_name)}` : ''}`]
  }

  /**
   * Format a SHOW statement.
   * @param body - VariableShowStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  variableShow(body: any, indent: string): string[] {
    return [`${indent}SHOW ${body.name}`]
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
   * Format a non-built-in function reference.
   * @param parts - String name parts.
   * @returns Lowercase unquoted function name.
   */
  functionReference(parts: readonly any[]): string {
    return (parts ?? []).map((part: any) => this.tag(part)?.[1]?.sval ?? '').join('.').toLowerCase()
  }

  /**
   * Format a CREATE TRIGGER statement.
   * @param body - CreateTrigStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  createTrigger(body: any, indent: string): string[] {
    const timing = body.timing === 2 ? 'BEFORE' : body.timing === 4 ? 'AFTER' : 'INSTEAD OF'
    const eventBits = body.events ?? 0
    const columns = body.columns?.length ? ` OF ${this.identifierList(body.columns)}` : ''
    const events = [
      eventBits & 4 ? 'INSERT' : '',
      eventBits & 8 ? 'DELETE' : '',
      eventBits & 16 ? `UPDATE${columns}` : '',
      eventBits & 32 ? 'TRUNCATE' : '',
    ].filter(Boolean).join(' OR ')
    const lines = [
      `${indent}CREATE ${body.isconstraint ? 'CONSTRAINT ' : ''}TRIGGER ${this.quoteIdentifier(body.trigname)}`,
      `${indent}${timing} ${events} ON ${this.relationName(body.relation)}`,
    ]
    if (body.constrrel) {
      lines.push(`${indent}FROM ${this.relationName(this.tag(body.constrrel)?.[1] ?? body.constrrel)}`)
    }
    if (body.deferrable) {
      lines.push(`${indent}DEFERRABLE${body.initdeferred ? ' INITIALLY DEFERRED' : ''}`)
    }
    lines.push(`${indent}FOR EACH ${body.row ? 'ROW' : 'STATEMENT'}`)
    if (body.whenClause) lines.push(`${indent}WHEN (${this.expr(body.whenClause)})`)
    const args = (body.args ?? []).map((arg: any) => this.literal(this.tag(arg)?.[1] ?? arg)).join(', ')
    lines.push(`${indent}  EXECUTE FUNCTION ${this.functionReference(body.funcname)}(${args})`)
    return lines
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
    const inferCondition = body.infer?.whereClause ? ` WHERE ${this.expr(body.infer.whereClause)}` : ''
    const updates = body.targetList ?? []
    const formatUpdate = (node: any): string => {
      const update = this.tag(node)?.[1]
      if (!update) return ''
      const name = typeof update.location === 'number' && update.location >= 0
        ? this.quoteIdentifier(this.readName(update.location).text)
        : update.name
      return `${name} = ${this.expr(update.val)}`
    }
    const lines: string[] = []
    if (updates.length === 0) {
      lines.push(`${indent}ON CONFLICT${target}${inferCondition} ${action}`)
    } else if (updates.length === 1) {
      lines.push(`${indent}ON CONFLICT${target}${inferCondition} ${action} SET ${formatUpdate(updates[0])}`)
    } else {
      lines.push(`${indent}ON CONFLICT${target}${inferCondition} ${action} SET`)
      updates.forEach((update: any, index: number) => {
        lines.push(`${indent}  ${formatUpdate(update)}${index < updates.length - 1 ? ',' : ''}`)
      })
    }
    if (body.whereClause) lines.push(...this.condition(body.whereClause, indent, 'WHERE'))
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
    const printer = this.expressionPrinters.get(tagged[0])
    return printer ? printer(tagged[1]) : this.unsupportedExpression(tagged[0], tagged[1])
  }

  /**
   * Format a SQL value function.
   * @param body - SQLValueFunction body.
   * @returns SQL keyword.
   */
  sqlValueFunction(body: any): string {
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
    return names[body.op] ?? this.unsupported('SQLValueFunction', body)
  }

  /**
   * Format an indirect field or array access.
   * @param body - A_Indirection body.
   * @returns Indirect expression.
   */
  indirection(body: any): string {
    return `${this.expr(body.arg)}${(body.indirection ?? []).map((node: any) => {
      const tagged = this.tag(node)
      if (tagged?.[0] === 'String') return `.${this.quoteIdentifier(tagged[1].sval)}`
      if (tagged?.[0] === 'A_Star') return '.*'
      if (tagged?.[0] === 'A_Indices') {
        const index = tagged[1]
        const lower = index.lidx ? this.expr(index.lidx) : ''
        const upper = index.uidx ? this.expr(index.uidx) : ''
        return index.is_slice ? `[${lower}:${upper}]` : `[${upper || lower}]`
      }
      return this.unsupported(tagged?.[0] ?? 'indirection', node)
    }).join('')}`
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
    const builtin = BUILTIN_FUNCTIONS.has((raw.split('.').at(-1) ?? '').toLowerCase())
    const name = raw.split('.').map(part => {
      if (part.startsWith('"')) return part
      return builtin ? part.toUpperCase() : part.toLowerCase()
    }).join('.')
    const distinct = body.agg_distinct ? 'DISTINCT ' : ''
    const args = body.agg_star ? '*' : (body.args ?? []).map((arg: any) => this.expr(arg)).join(', ')
    const order = body.agg_order?.length
      ? ` ORDER BY ${body.agg_order.map((item: any) => this.sort(item)).join(', ')}`
      : ''
    const filter = body.agg_filter ? ` FILTER (WHERE ${this.expr(body.agg_filter)})` : ''
    const within = body.agg_within_group ? ' WITHIN GROUP' : ''
    const over = body.over
      ? body.over.name && !body.over.partitionClause?.length && !body.over.orderClause?.length
        ? ` OVER ${this.quoteIdentifier(body.over.name)}`
        : ` OVER (${this.windowDef(body.over)})`
      : ''
    return `${name}(${distinct}${args}${order})${filter}${within}${over}`
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
    const implicit = new Set(['sqlstate', 'sqlerrm'])
    const variables = (this.functionNode.datums ?? [])
      .map((datum: any) => datum.PLpgSQL_var ?? datum.PLpgSQL_rec)
      .filter((variable: any) => (
        variable?.lineno && variable.refname && variable.datatype && !implicit.has(variable.refname)
      ))
    if (variables.length > 0) {
      lines.push('DECLARE')
      for (const variable of variables) {
        const type = String(variable.datatype.PLpgSQL_type?.typname ?? 'record').toUpperCase()
        const constant = variable.isconst ? ' CONSTANT' : ''
        const notnull = variable.notnull ? ' NOT NULL' : ''
        const initializer = variable.default_val?.PLpgSQL_expr?.query
          ? ` := ${this.expression(variable.default_val.PLpgSQL_expr.query)}`
          : ''
        lines.push(`  ${variable.refname}${constant} ${type}${notnull}${initializer};`)
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
        const params = (body.params ?? [])
          .map((param: any) => this.expression(param.PLpgSQL_expr?.query ?? '')).filter(Boolean)
        const suffix = params.length > 0 ? `, ${params.join(', ')}` : ''
        return [`${indent}RAISE ${level} '${String(body.message ?? '').replace(/'/gu, "''")}'${suffix};`]
      }
      case 'PLpgSQL_stmt_execsql': {
        const query = body.sqlstmt?.PLpgSQL_expr?.query ?? ''
        if (!query) return []
        const formatted = formatSQL(query, `${indent}`)
        if (!formatted) return []
        const lines = formatted.split('\n')
        if (body.into && body.target) {
          const target = this.plTarget(body.target)
          const from = lines.findIndex(line => /^\s*FROM\b/u.test(line))
          if (from >= 0) lines.splice(from, 0, `${indent}INTO ${target}`)
          else lines.push(`${indent}INTO ${target}`)
        }
        lines[lines.length - 1] = `${lines[lines.length - 1]};`
        return lines
      }
      case 'PLpgSQL_stmt_perform': {
        const query = (body.expr?.PLpgSQL_expr?.query ?? '').replace(/^SELECT\s+/iu, '')
        return [`${indent}PERFORM ${this.expression(query)};`]
      }
      case 'PLpgSQL_stmt_loop': {
        const lines = [`${indent}LOOP`]
        for (const statement of body.body ?? []) lines.push(...this.statement(statement, `${indent}  `))
        lines.push(`${indent}END LOOP;`)
        return lines
      }
      case 'PLpgSQL_stmt_while': {
        const lines = [`${indent}WHILE ${this.expression(body.cond?.PLpgSQL_expr?.query ?? '')} LOOP`]
        for (const statement of body.body ?? []) lines.push(...this.statement(statement, `${indent}  `))
        lines.push(`${indent}END LOOP;`)
        return lines
      }
      case 'PLpgSQL_stmt_fori': {
        const reverse = body.reverse ? ' REVERSE' : ''
        const step = body.step ? ` BY ${this.expression(body.step.PLpgSQL_expr?.query ?? '')}` : ''
        const name = body.var?.PLpgSQL_var?.refname ?? body.var?.refname ?? 'i'
        const lower = this.expression(body.lower?.PLpgSQL_expr?.query ?? '')
        const upper = this.expression(body.upper?.PLpgSQL_expr?.query ?? '')
        const lines = [`${indent}FOR ${name} IN${reverse} ${lower}..${upper}${step} LOOP`]
        for (const statement of body.body ?? []) lines.push(...this.statement(statement, `${indent}  `))
        lines.push(`${indent}END LOOP;`)
        return lines
      }
      case 'PLpgSQL_stmt_fors': {
        const variable = body.var?.PLpgSQL_var?.refname ?? body.var?.PLpgSQL_rec?.refname ?? body.var?.refname ?? 'row'
        const lines = [`${indent}FOR ${variable} IN ${this.expression(body.query?.PLpgSQL_expr?.query ?? '')} LOOP`]
        for (const statement of body.body ?? []) lines.push(...this.statement(statement, `${indent}  `))
        lines.push(`${indent}END LOOP;`)
        return lines
      }
      case 'PLpgSQL_stmt_foreach_a': {
        const variable = body.var?.PLpgSQL_var?.refname ?? body.var?.refname ?? 'item'
        const slice = body.slice ? ` SLICE ${body.slice}` : ''
        const array = this.expression(body.expr?.PLpgSQL_expr?.query ?? '')
        const lines = [`${indent}FOREACH ${variable}${slice} IN ARRAY ${array} LOOP`]
        for (const statement of body.body ?? []) lines.push(...this.statement(statement, `${indent}  `))
        lines.push(`${indent}END LOOP;`)
        return lines
      }
      case 'PLpgSQL_stmt_exit': {
        const action = body.is_exit ? 'EXIT' : 'CONTINUE'
        const label = body.label ? ` ${body.label}` : ''
        const condition = body.cond?.PLpgSQL_expr?.query ? ` WHEN ${this.expression(body.cond.PLpgSQL_expr.query)}` : ''
        return [`${indent}${action}${label}${condition};`]
      }
      case 'PLpgSQL_stmt_case': {
        const test = body.t_expr?.PLpgSQL_expr?.query
          ? ` ${this.expression(body.t_expr.PLpgSQL_expr.query)}`
          : ''
        const lines = [`${indent}CASE${test}`]
        for (const item of body.case_when_list ?? []) {
          const clause = item.PLpgSQL_case_when
          if (!clause) continue
          lines.push(`${indent}  WHEN ${this.expression(clause.expr?.PLpgSQL_expr?.query ?? '')} THEN`)
          for (const statement of clause.stmts ?? []) lines.push(...this.statement(statement, `${indent}    `))
        }
        if (body.have_else) {
          lines.push(`${indent}  ELSE`)
          for (const statement of body.else_stmts ?? []) lines.push(...this.statement(statement, `${indent}    `))
        }
        lines.push(`${indent}END CASE;`)
        return lines
      }
      case 'PLpgSQL_stmt_assert': {
        const condition = this.expression(body.cond?.PLpgSQL_expr?.query ?? '')
        const message = body.message?.PLpgSQL_expr?.query ? `, ${this.expression(body.message.PLpgSQL_expr.query)}` : ''
        return [`${indent}ASSERT ${condition}${message};`]
      }
      case 'PLpgSQL_stmt_dynexecute': {
        const query = this.expression(body.query?.PLpgSQL_expr?.query ?? '')
        const into = body.into && body.target ? ` INTO ${this.plTarget(body.target)}` : ''
        const params = (body.params ?? [])
          .map((param: any) => this.expression(param.PLpgSQL_expr?.query ?? '')).join(', ')
        return [`${indent}EXECUTE ${query}${into}${params ? ` USING ${params}` : ''};`]
      }
      case 'PLpgSQL_stmt_commit':
        return [`${indent}COMMIT;`]
      case 'PLpgSQL_stmt_rollback':
        return [`${indent}ROLLBACK;`]
      case 'PLpgSQL_stmt_return_query': {
        const query = this.expression(body.query?.PLpgSQL_expr?.query ?? '')
        return [`${indent}RETURN QUERY ${query};`]
      }
      case 'PLpgSQL_stmt_return_next': {
        const query = this.expression(body.expr?.PLpgSQL_expr?.query ?? '')
        return [`${indent}RETURN NEXT ${query};`]
      }
      case 'PLpgSQL_stmt_getdiag': {
        const items = (body.diag_items ?? []).map((item: any) => {
          const diag = item.PLpgSQL_diag_item
          if (!diag) throw new UnsupportedNodeError('PLpgSQL_diag_item')
          const datum = this.functionNode.datums?.[diag.target]
          const name = datum?.PLpgSQL_var?.refname ?? datum?.PLpgSQL_rec?.refname
          if (!name) throw new UnsupportedNodeError('PLpgSQL_diag_item_target')
          return `${name} = ${this.diagKind(diag.kind)}`
        })
        return [`${indent}GET${body.is_stacked ? ' STACKED' : ''} DIAGNOSTICS ${items.join(', ')};`]
      }
      default:
        return this.unsupportedPl(type, body, indent)
    }
  }

  /**
   * Map a PL/pgSQL diagnostics kind to SQL.
   * @param kind - Raw diagnostics kind.
   * @returns Diagnostics keyword.
   */
  diagKind(kind: string): string {
    const names: Record<string, string> = {
      COLUMN_NAME: 'COLUMN_NAME',
      CONSTRAINT_NAME: 'CONSTRAINT_NAME',
      EXCEPTION_DETAIL: 'PG_EXCEPTION_DETAIL',
      EXCEPTION_HINT: 'PG_EXCEPTION_HINT',
      MESSAGE_TEXT: 'MESSAGE_TEXT',
      PG_CONTEXT: 'PG_CONTEXT',
      PG_DATATYPE_NAME: 'PG_DATATYPE_NAME',
      PG_ROUTINE_OID: 'PG_ROUTINE_OID',
      RETURNED_SQLSTATE: 'RETURNED_SQLSTATE',
      ROW_COUNT: 'ROW_COUNT',
      SCHEMA_NAME: 'SCHEMA_NAME',
      TABLE_NAME: 'TABLE_NAME',
    }
    const value = names[kind]
    if (!value) throw new UnsupportedNodeError(`PLpgSQL diagnostic ${kind}`)
    return value
  }

  /**
   * Reject a PL/pgSQL node without a faithful printer.
   * @param type - Raw node tag.
   * @param _args - Unsupported call arguments.
   */
  unsupportedPl(type: string, ..._args: any[]): never {
    void _args
    throw new UnsupportedNodeError(type)
  }

  /**
   * Format a PL/pgSQL assignment target.
   * @param target - PLpgSQL_row, PLpgSQL_var, or PLpgSQL_rec.
   * @returns Comma-separated target names.
   */
  plTarget(target: any): string {
    const row = target?.PLpgSQL_row
    if (row?.fields?.length) return row.fields.map((field: any) => field.name).join(', ')
    const variable = target?.PLpgSQL_var ?? target?.PLpgSQL_rec
    if (variable?.refname) return variable.refname
    throw new UnsupportedNodeError('PLpgSQL target')
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
        const result = formatSQLResult(dedented, `${baseIndent}  `)
        if (result.unsupported) {
          context.report({
            data: { construct: result.unsupported },
            messageId: 'unsupportedSql',
            node,
          })
          return
        }
        let body = `\n${result.formatted}\n${baseIndent}`
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
      unsupportedSql: 'SQL formatting is not supported for {{construct}}.',
    },
    schema: [],
    type: 'layout',
  },
}
