/* eslint-disable camelcase */
import type { Node } from 'libpg-query'
import { parsePlPgSQLSync, parseSync, scanSync } from 'libpg-query'
import { SourceText } from './source'
import { bodyOf, kindOf, SemanticError, stringValue } from './types'

const PL_LOCATIONS = new Set([
  'dno', 'found_varno', 'lineno', 'location', 'new_varno', 'old_varno', 'out_param_varno',
  'retvarno', 'stmt_len', 'stmt_location', 't_varno', 'varno',
])

/** Identifier-bearing SQL fields whose case is presentation, not identity. */
const SQL_IDENTIFIER_FIELDS = new Set([
  'aliasname', 'catalogname', 'colname', 'conname', 'ctename', 'defname', 'idxname', 'name',
  'relname', 'schemaname', 'trigname',
])

/** Identifier-bearing PL/pgSQL fields. */
const PL_IDENTIFIER_FIELDS = new Set(['condname', 'fieldname', 'label', 'name', 'refname'])

const PL_TYPES: Record<string, string> = {
  bigint: 'bigint',
  bool: 'boolean',
  boolean: 'boolean',
  bytea: 'bytea',
  date: 'date',
  float4: 'real',
  float8: 'double precision',
  int: 'integer',
  int2: 'smallint',
  int4: 'integer',
  int8: 'bigint',
  integer: 'integer',
  json: 'json',
  jsonb: 'jsonb',
  name: 'name',
  numeric: 'numeric',
  oid: 'oid',
  real: 'real',
  record: 'record',
  smallint: 'smallint',
  text: 'text',
  time: 'time',
  timestamp: 'timestamp',
  timestamptz: 'timestamptz',
  timetz: 'timetz',
  uuid: 'uuid',
  varchar: 'varchar',
  void: 'void',
}

/**
 * Verify that formatted SQL preserves the original parser meaning.
 *
 * Throws a `SemanticError` when any meaningful structure, PL/pgSQL executable
 * expression, or comment differs. The caller converts that into a non-fixable
 * result; it is never allowed to produce an autofix.
 * @param original
 * @param formatted
 */
export function verifySemantics(original: string, formatted: string): void {
  const originalSql = parseSync(original)
  const formattedSql = parseSync(formatted)
  const originalTree = originalSql.stmts.map(statement => normalizeSqlNode(statement.stmt as Node))
  const formattedTree = formattedSql.stmts.map(statement => normalizeSqlNode(statement.stmt as Node))
  if (stable(originalTree) !== stable(formattedTree)) {
    throw new SemanticError('formatted SQL changed the parser structure')
  }

  verifyIdentifierPositions(original, formatted)

  const originalComments = comments(original)
  const formattedComments = comments(formatted)
  if (stable(originalComments) !== stable(formattedComments)) {
    throw new SemanticError('formatted SQL changed comments')
  }

  const originalHasPl = originalSql.stmts.some(statement => hasPlBody(statement.stmt as Node))
  if (!originalHasPl) return
  const originalPl = normalizePlTree(parsePlPgSQLSync(original))
  const formattedPl = normalizePlTree(parsePlPgSQLSync(formatted))
  if (stable(originalPl) !== stable(formattedPl)) {
    throw new SemanticError('formatted SQL changed PL/pgSQL meaning')
  }
}

/**
 * Verify only SQL structure, used by negative-control tests.
 * @param original
 * @param formatted
 */
export function verifySqlSemantics(original: string, formatted: string): void {
  const originalTree = parseSync(original).stmts.map(statement => normalizeSqlNode(statement.stmt as Node))
  const formattedTree = parseSync(formatted).stmts.map(statement => normalizeSqlNode(statement.stmt as Node))
  if (stable(originalTree) !== stable(formattedTree)) {
    throw new SemanticError('SQL meaning changed')
  }
  verifyIdentifierPositions(original, formatted)
}

/**
 * Return the normalized PL/pgSQL tree for tests and diagnostics.
 * @param sql
 */
export function plSemanticTree(sql: string): unknown {
  return normalizePlTree(parsePlPgSQLSync(sql))
}

/**
 * Return the normalized SQL tree for tests and diagnostics.
 * @param sql
 */
export function sqlSemanticTree(sql: string): unknown {
  return parseSync(sql).stmts.map(statement => normalizeSqlNode(statement.stmt as Node))
}

/**
 * Verify only PL/pgSQL structure, used by negative-control tests.
 * @param original
 * @param formatted
 */
export function verifyPlSemantics(original: string, formatted: string): void {
  const originalTree = normalizePlTree(parsePlPgSQLSync(original))
  const formattedTree = normalizePlTree(parsePlPgSQLSync(formatted))
  if (stable(originalTree) !== stable(formattedTree)) {
    throw new SemanticError('PL/pgSQL meaning changed')
  }
}

/**
 * Normalize one SQL AST node, preserving every meaningful field.
 * @param value
 */
function normalizeSqlNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSqlNode)
  if (!value || typeof value !== 'object') return value
  const kind = kindOf(value)
  if (kind === 'String') {
    const body = bodyOf<Record<string, unknown>>(value)
    return {
      String: {
        ...normalizeSqlObject(body, key => key === 'sval'),
        sval: String(body.sval ?? '').toLowerCase(),
      },
    }
  }
  if (kind === 'CreateFunctionStmt' || kind === 'DoStmt') {
    const body = bodyOf<Record<string, unknown>>(value)
    const field = body.options !== undefined ? 'options' : 'args'
    const options = (body[field] ?? []) as unknown[]
    return {
      [kind]: {
        ...normalizeSqlObject(body, key => key === 'options' || key === 'args'),
        [field]: options.map(option => normalizeFunctionOption(option)),
      },
    }
  }
  return normalizeSqlObject(value)
}

/**
 * Normalize a SQL object's fields, dropping only source metadata.
 * @param value
 * @param skip
 */
function normalizeSqlObject(value: object, skip: (key: string) => boolean = () => false): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (skip(key)) continue
    if (key === 'location' || key === 'stmt_location' || key === 'stmt_len'
      || key.endsWith('_start') || key.endsWith('_end')) continue
    result[key] = typeof child === 'string' && SQL_IDENTIFIER_FIELDS.has(key)
      ? child.toLowerCase()
      : normalizeSqlNode(child)
  }
  return result
}

/**
 * Normalize a function option, replacing the opaque PL body with a marker.
 * @param value
 */
function normalizeFunctionOption(value: unknown): unknown {
  const kind = kindOf(value)
  if (kind !== 'DefElem') return normalizeSqlNode(value)
  const option = bodyOf<Record<string, unknown>>(value)
  if (option.defname !== 'as') return normalizeSqlNode(value)
  return { DefElem: { ...normalizeSqlObject(option, key => key === 'arg'), arg: '<body>' } }
}

/**
 * Whether a statement carries a PL/pgSQL body.
 * @param stmt
 */
function hasPlBody(stmt: Node): boolean {
  const kind = kindOf(stmt)
  return kind === 'CreateFunctionStmt' || kind === 'DoStmt'
}

/**
 * Normalize the PL/pgSQL tree.
 * @param value
 * @param datums
 */
function normalizePlTree(value: unknown, datums: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map(child => normalizePlTree(child, datums))
  if (!value || typeof value !== 'object') return value
  const kind = kindOf(value)
  if (kind === 'PLpgSQL_function') {
    const fn = bodyOf<Record<string, unknown>>(value)
    const entries = (fn.datums as unknown[] | undefined) ?? []
    const names = entries.map(entry => {
      const body = bodyOf<Record<string, unknown>>(entry)
      return String(body.refname ?? '')
    })
    return {
      PLpgSQL_function: {
        ...normalizePlObject(fn, key => key === 'datums', names),
        datums: entries.map(entry => normalizePlTree(entry, names)),
      },
    }
  }
  if (kind === 'PLpgSQL_stmt_return') {
    const statement = bodyOf<Record<string, unknown>>(value)
    const target = typeof statement.retvarno === 'number' ? datums[statement.retvarno] : undefined
    return {
      PLpgSQL_stmt_return: {
        ...normalizePlObject(statement, key => key === 'retvarno', datums),
        ...(target === undefined ? {} : { target }),
      },
    }
  }
  if (kind === 'PLpgSQL_stmt_assign') {
    const statement = bodyOf<Record<string, unknown>>(value)
    return {
      PLpgSQL_stmt_assign: {
        ...normalizePlObject(statement, key => key === 'expr', datums),
        expr: normalizeAssignmentExpr(statement.expr),
      },
    }
  }
  if (kind === 'PLpgSQL_expr') {
    const expression = bodyOf<Record<string, unknown>>(value)
    return {
      PLpgSQL_expr: {
        ...normalizePlObject(expression, key => key === 'query', datums),
        query: canonicalExpression(String(expression.query ?? '')),
      },
    }
  }
  if (kind === 'PLpgSQL_type') {
    const type = bodyOf<Record<string, unknown>>(value)
    const name = String(type.typname ?? '')
    const array = name.endsWith('[]') ? '[]' : ''
    const base = array === '' ? name : name.slice(0, -2)
    return {
      PLpgSQL_type: {
        ...normalizePlObject(type, key => key === 'typname', datums),
        typname: `${PL_TYPES[base.toLowerCase()] ?? base}${array}`,
      },
    }
  }
  if (kind === null) return normalizePlObject(value, () => false, datums)
  return { [kind]: normalizePlObject(bodyOf<Record<string, unknown>>(value), () => false, datums) }
}

/**
 * Normalize a PL object's fields.
 * @param value
 * @param skip
 * @param datums
 */
function normalizePlObject(
  value: object,
  skip: (key: string) => boolean = () => false,
  datums: readonly string[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (skip(key)) continue
    if (PL_LOCATIONS.has(key) || key.endsWith('_start') || key.endsWith('_end')) continue
    result[key] = typeof child === 'string' && PL_IDENTIFIER_FIELDS.has(key)
      ? child.toLowerCase()
      : normalizePlTree(child, datums)
  }
  return result
}

/**
 * Normalize a PL assignment expression.
 * @param value
 */
function normalizeAssignmentExpr(value: unknown): unknown {
  if (!value || typeof value !== 'object' || kindOf(value) !== 'PLpgSQL_expr') return normalizePlTree(value)
  const expression = bodyOf<{ query?: string }>(value)
  const query = String(expression.query ?? '')
  const assignment = splitTopLevelAssignment(query)
  return {
    PLpgSQL_expr: {
      query: assignment
        ? { assign: [canonicalExpression(assignment.target), canonicalExpression(assignment.value)] }
        : canonicalExpression(query),
    },
  }
}

/**
 * Canonicalize one embedded SQL expression.
 * @param query
 */
function canonicalExpression(query: string): unknown {
  const trimmed = query.trim().replace(/;$/u, '').trim()
  if (trimmed === '') return { empty: true }
  for (const candidate of [trimmed, `SELECT ${trimmed}`]) {
    try {
      const parsed = parseSync(candidate)
      if (parsed.stmts.length === 0) continue
      const tree = parsed.stmts.map(statement => normalizeSqlNode(statement.stmt as Node))
      if (candidate === `SELECT ${trimmed}`) {
        const statement = parsed.stmts[0]?.stmt as Node
        if (kindOf(statement) === 'SelectStmt') {
          const select = bodyOf<Record<string, unknown>>(statement)
          const targets = (select.targetList as unknown[] | undefined) ?? []
          if (targets.length === 1) {
            return normalizeSqlNode(bodyOf<{ val?: unknown }>(targets[0]).val)
          }
        }
      }
      return tree
    } catch {
      // Try the next candidate.
    }
  }
  throw new SemanticError(`cannot canonicalize PL/pgSQL expression "${query.slice(0, 40)}"`)
}

/**
 * Split an assignment at its top-level operator using the PostgreSQL scanner.
 * @param query
 */
function splitTopLevelAssignment(query: string): { target: string, value: string } | null {
  let depth = 0
  for (const token of scanSync(query).tokens) {
    if (token.text === '(' || token.text === '[') depth += 1
    else if (token.text === ')' || token.text === ']') depth -= 1
    else if (depth === 0 && (token.text === ':=' || token.text === '=')) {
      const target = query.slice(0, token.start).trim()
      const value = query.slice(token.end).trim()
      if (target && value) return { target, value }
    }
  }
  return null
}

/** Verify identifier spelling at each identity-bearing AST position. */
function verifyIdentifierPositions(original: string, formatted: string): void {
  const originalStatements = parseSync(original).stmts.map(statement => statement.stmt as Node)
  const formattedStatements = parseSync(formatted).stmts.map(statement => statement.stmt as Node)
  compareIdentifiers(
    originalStatements,
    formattedStatements,
    new SourceText(original),
    new SourceText(formatted),
  )
}

/** Compare identifier-bearing nodes in parallel AST order. */
function compareIdentifiers(
  original: unknown,
  formatted: unknown,
  originalSource: SourceText,
  formattedSource: SourceText,
): void {
  if (Array.isArray(original) || Array.isArray(formatted)) {
    if (!Array.isArray(original) || !Array.isArray(formatted) || original.length !== formatted.length) {
      throw new SemanticError('formatted SQL changed identifier structure')
    }
    original.forEach((value, index) => compareIdentifiers(value, formatted[index], originalSource, formattedSource))
    return
  }
  if (!original || typeof original !== 'object' || !formatted || typeof formatted !== 'object') return
  const originalKind = kindOf(original)
  const formattedKind = kindOf(formatted)
  if (originalKind !== formattedKind) throw new SemanticError('formatted SQL changed identifier structure')
  if (originalKind === 'String') return
  if (originalKind === null) {
    const originalValue = original as Record<string, unknown>
    const formattedValue = formatted as Record<string, unknown>
    for (const key of Object.keys(originalValue)) {
      compareIdentifiers(originalValue[key], formattedValue[key], originalSource, formattedSource)
    }
    return
  }
  switch (originalKind) {
    case 'ColumnRef':
      compareQualified(original, formatted, originalSource, formattedSource, 'ColumnRef')
      return
    case 'RangeVar':
      compareQualified(original, formatted, originalSource, formattedSource, 'RangeVar')
      compareAlias(original, formatted, originalSource, formattedSource)
      return
    case 'ResTarget':
      compareResTarget(original, formatted, originalSource, formattedSource)
      break
    case 'ColumnDef':
      compareIdentifierAt(original, formatted, originalSource, formattedSource, 'colname')
      break
    case 'Constraint':
      compareConstraint(original, formatted, originalSource, formattedSource)
      break
    case 'CommonTableExpr':
      compareCte(original, formatted, originalSource, formattedSource)
      break
    case 'FunctionParameter':
      compareIdentifierAt(original, formatted, originalSource, formattedSource, 'name')
      break
    default:
      break
  }
  const originalValue = bodyOf<Record<string, unknown>>(original)
  const formattedValue = bodyOf<Record<string, unknown>>(formatted)
  for (const key of Object.keys(originalValue)) {
    if (key === 'location' || key.endsWith('_start') || key.endsWith('_end')) continue
    compareIdentifiers(originalValue[key], formattedValue[key], originalSource, formattedSource)
  }
}

/** Compare a qualified name's exact source components. */
function compareQualified(
  original: unknown,
  formatted: unknown,
  originalSource: SourceText,
  formattedSource: SourceText,
  label: string,
): void {
  const originalValue = bodyOf<Record<string, unknown>>(original)
  const formattedValue = bodyOf<Record<string, unknown>>(formatted)
  let fallback: string[]
  if (label === 'ColumnRef') {
    fallback = ((originalValue.fields as Node[] | undefined) ?? [])
      .filter(field => kindOf(field) === 'String')
      .map(field => stringValue(field))
  } else {
    fallback = [originalValue.catalogname, originalValue.schemaname, originalValue.relname]
      .filter((part): part is string => typeof part === 'string')
  }
  const originalParts = originalSource.qualifiedParts(
    typeof originalValue.location === 'number' ? originalValue.location : undefined,
    fallback,
  )
  const formattedParts = formattedSource.qualifiedParts(
    typeof formattedValue.location === 'number' ? formattedValue.location : undefined,
    fallback,
  )
  compareParts(originalParts, formattedParts, label)
}

/** Compare a RangeVar alias's exact source spelling. */
function compareAlias(
  original: unknown,
  formatted: unknown,
  originalSource: SourceText,
  formattedSource: SourceText,
): void {
  const originalValue = bodyOf<Record<string, unknown>>(original)
  const formattedValue = bodyOf<Record<string, unknown>>(formatted)
  if (!originalValue.alias && !formattedValue.alias) return
  const originalAlias = originalSource.relationAlias(
    typeof originalValue.location === 'number' ? originalValue.location : undefined,
  )
  const formattedAlias = formattedSource.relationAlias(
    typeof formattedValue.location === 'number' ? formattedValue.location : undefined,
  )
  compareParts([originalAlias ?? ''], [formattedAlias ?? ''], 'alias')
}

/** Compare a ResTarget identifier at its source position. */
function compareResTarget(
  original: unknown,
  formatted: unknown,
  originalSource: SourceText,
  formattedSource: SourceText,
): void {
  const originalValue = bodyOf<Record<string, unknown>>(original)
  const formattedValue = bodyOf<Record<string, unknown>>(formatted)
  if (originalValue.name === undefined || formattedValue.name === undefined) return
  compareParts(
    [targetIdentifier(original, originalValue, originalSource)],
    [targetIdentifier(formatted, formattedValue, formattedSource)],
    'ResTarget',
  )
}

/** Resolve the source spelling of a ResTarget name. */
function targetIdentifier(node: unknown, value: Record<string, unknown>, source: SourceText): string {
  const location = typeof value.location === 'number' ? value.location : undefined
  const name = String(value.name ?? '')
  if (!value.val || typeof value.val !== 'object') return source.identifierAt(location, name)
  return source.explicitAliasAfter(location ?? 0) ??
    source.identifierAt(location, name)
}

/** Compare an identifier-bearing field at a node location. */
function compareIdentifierAt(
  original: unknown,
  formatted: unknown,
  originalSource: SourceText,
  formattedSource: SourceText,
  field: string,
): void {
  const originalValue = bodyOf<Record<string, unknown>>(original)
  const formattedValue = bodyOf<Record<string, unknown>>(formatted)
  const name = originalValue[field]
  if (typeof name !== 'string') return
  compareParts(
    [originalSource.identifierAt(
      typeof originalValue.location === 'number' ? originalValue.location : undefined,
      name,
    )],
    [formattedSource.identifierAt(
      typeof formattedValue.location === 'number' ? formattedValue.location : undefined,
      name,
    )],
    field,
  )
}

/** Compare constraint names and key columns at their source positions. */
function compareConstraint(
  original: unknown,
  formatted: unknown,
  originalSource: SourceText,
  formattedSource: SourceText,
): void {
  const originalValue = bodyOf<Record<string, unknown>>(original)
  const formattedValue = bodyOf<Record<string, unknown>>(formatted)
  const originalPosition = typeof originalValue.location === 'number' ? originalValue.location : 0
  const formattedPosition = typeof formattedValue.location === 'number' ? formattedValue.location : 0
  if (typeof originalValue.conname === 'string') {
    compareParts(
      [originalSource.identifierNear(originalPosition, originalValue.conname)],
      [formattedSource.identifierNear(formattedPosition, String(formattedValue.conname ?? originalValue.conname))],
      'constraint name',
    )
  }
  compareNames(
    originalValue.keys,
    formattedValue.keys,
    originalPosition,
    formattedPosition,
    originalSource,
    formattedSource,
    'constraint keys',
  )
  compareNames(
    originalValue.fk_attrs,
    formattedValue.fk_attrs,
    originalPosition,
    formattedPosition,
    originalSource,
    formattedSource,
    'foreign-key columns',
  )
  const originalPk = nodeLocation(originalValue.pktable)
  const formattedPk = nodeLocation(formattedValue.pktable)
  compareNames(
    originalValue.pk_attrs,
    formattedValue.pk_attrs,
    originalPk ?? originalPosition,
    formattedPk ?? formattedPosition,
    originalSource,
    formattedSource,
    'referenced columns',
  )
}

/** Compare a list of identifier nodes by folded source position. */
function compareNames(
  original: unknown,
  formatted: unknown,
  originalPosition: number,
  formattedPosition: number,
  originalSource: SourceText,
  formattedSource: SourceText,
  label: string,
): void {
  if (!Array.isArray(original) || !Array.isArray(formatted)) return
  original.forEach((item, index) => {
    const name = stringValue(item)
    const formattedName = stringValue(formatted[index])
    compareParts(
      [originalSource.identifierNear(originalPosition, name)],
      [formattedSource.identifierNear(formattedPosition, formattedName)],
      label,
    )
  })
}

/** Compare a CTE name's exact source spelling. */
function compareCte(
  original: unknown,
  formatted: unknown,
  originalSource: SourceText,
  formattedSource: SourceText,
): void {
  const originalValue = bodyOf<Record<string, unknown>>(original)
  const formattedValue = bodyOf<Record<string, unknown>>(formatted)
  if (typeof originalValue.ctename !== 'string') return
  const originalQuery = originalValue.ctequery as Node
  const formattedQuery = formattedValue.ctequery as Node
  compareParts(
    [originalSource.identifierBefore(originalSource.span(originalQuery)?.start ?? 0, originalValue.ctename)],
    [formattedSource.identifierBefore(
      formattedSource.span(formattedQuery)?.start ?? 0,
      String(formattedValue.ctename ?? originalValue.ctename),
    )],
    'CTE name',
  )
}

/** Read a node's source location without assuming it is a tagged node. */
function nodeLocation(value: unknown): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const location = (value as { location?: unknown }).location
  return typeof location === 'number' ? location : undefined
}

/** Compare canonical identifier spellings. */
function compareParts(original: readonly string[], formatted: readonly string[], label: string): void {
  if (original.length !== formatted.length) {
    throw new SemanticError(`formatted SQL changed ${label}`)
  }
  original.forEach((part, index) => {
    const expected = unquote(part)
    const actual = unquote(formatted[index] as string)
    if (expected !== actual) {
      throw new SemanticError(`formatted SQL changed ${label}: ${expected} -> ${actual}`)
    }
  })
}

/** Remove surrounding double quotes from an identifier token. */
function unquote(text: string): string {
  return text.startsWith('"') && text.endsWith('"')
    ? text.slice(1, -1).replace(/""/gu, '"')
    : text
}

/**
 * Comments in source order.
 * @param sql
 */
function comments(sql: string): string[] {
  return scanSync(sql).tokens
    .filter(token => token.tokenName === 'SQL_COMMENT' || token.tokenName === 'C_COMMENT')
    .map(token => token.text)
}

/**
 * Deterministic JSON.
 * @param value
 */
function stable(value: unknown): string {
  return JSON.stringify(value)
}
