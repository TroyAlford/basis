/* eslint-disable @stylistic/max-len -- SQL identifier names and fixtures need long lines. */
/* eslint-disable @typescript-eslint/no-explicit-any -- PostgreSQL AST boundary. */
import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { loadModule, parseSync } from 'libpg-query'
import { SqlSource } from './sql/source'
import { extractSqlTemplate, isSqlTag } from './sql/template'

await loadModule()

const SNAKE_CASE = /^[a-z_][a-z0-9_]*$/u
const STRUCTURAL_WORDS = new Set([
  'as', 'except', 'fetch', 'for', 'from', 'group', 'having', 'intersect', 'into', 'join', 'limit',
  'offset', 'on', 'ordinality', 'order', 'returning', 'select', 'set', 'union', 'using', 'values',
  'where', 'window', 'with',
])

/** Report unquoted identifiers that do not follow snake_case. */
export const sqlIdentifierStyle: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression): void {
        if (!isSqlTag(node.tag)) return
        const { sql } = extractSqlTemplate(node, context)
        if (sql.trim() === '') return
        let parsed: ReturnType<typeof parseSync>
        try {
          parsed = parseSync(sql)
        } catch {
          return
        }
        const source = new SqlSource(sql)
        const reported = new Set<string>()
        const check = (raw: string | undefined): void => {
          if (raw === undefined || raw === '' || raw.startsWith('"')) return
          if (STRUCTURAL_WORDS.has(raw.toLowerCase()) || SNAKE_CASE.test(raw) || reported.has(raw)) return
          reported.add(raw)
          context.report({
            data: { name: raw },
            messageId: 'unquotedIdentifier',
            node,
          })
        }
        for (const statement of parsed.stmts) checkNode(statement.stmt, source, check)
      },
    }
  },
  meta: {
    docs: {
      description: 'Require unquoted SQL identifiers to use snake_case.',
    },
    messages: {
      unquotedIdentifier: 'Unquoted SQL identifier "{{name}}" is not snake_case; quote it or rename it.',
    },
    schema: [],
    type: 'suggestion',
  },
}

/** Find the single protocol tag on a raw node. */
function kindOf(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  for (const key of Object.keys(value)) {
    if (key === 'location') continue
    const child = (value as Record<string, unknown>)[key]
    if (child && typeof child === 'object' && !Array.isArray(child)) return key
  }
  return null
}

/** Read a tagged node's body. */
function bodyOf<T>(value: unknown): T {
  return (value as Record<string, T>)[kindOf(value) as string] as T
}

/** Walk one SQL AST node and check every identity-bearing identifier. */
function checkNode(
  value: unknown,
  source: SqlSource,
  check: (raw: string | undefined) => void,
): void {
  if (Array.isArray(value)) {
    for (const child of value) checkNode(child, source, check)
    return
  }
  if (!value || typeof value !== 'object') return
  const kind = kindOf(value)
  if (kind === 'String') return
  if (kind === null) {
    for (const child of Object.values(value)) checkNode(child, source, check)
    return
  }
  if (kind === 'ColumnRef') {
    const node = bodyOf<Record<string, unknown>>(value)
    const fields = (node.fields as unknown[] | undefined) ?? []
    const fallback = fields.filter(field => kindOf(field) === 'String').map(field => String(bodyOf<{ sval?: string }>(field).sval ?? ''))
    for (const part of source.qualifiedParts(node.location as number | undefined, fallback)) check(part)
    return
  }
  if (kind === 'RangeVar') {
    const node = bodyOf<Record<string, unknown>>(value)
    const fallback = [node.catalogname, node.schemaname, node.relname]
      .filter((part): part is string => typeof part === 'string')
    for (const part of source.qualifiedParts(node.location as number | undefined, fallback)) check(part)
    if (node.alias) check(source.relationAlias(node.location as number | undefined))
    return
  }
  if (kind === 'ResTarget') {
    const node = bodyOf<Record<string, unknown>>(value)
    if (typeof node.name === 'string') {
      const location = typeof node.location === 'number' ? node.location : undefined
      const alias = node.val && typeof node.val === 'object' ? source.explicitAliasAfter(location ?? 0) : undefined
      check(alias ?? source.identifierAt(location, node.name))
    }
    checkNode(node.val, source, check)
    return
  }
  if (kind === 'ColumnDef') {
    const node = bodyOf<Record<string, unknown>>(value)
    check(source.identifierAt(typeof node.location === 'number' ? node.location : undefined, String(node.colname ?? '')))
  } else if (kind === 'Constraint') {
    checkConstraint(bodyOf<Record<string, unknown>>(value), source, check)
  } else if (kind === 'CommonTableExpr') {
    const node = bodyOf<Record<string, unknown>>(value)
    const start = source.span(node.ctequery)?.start ?? 0
    check(source.identifierBefore(start, String(node.ctename ?? '')))
  } else if (kind === 'FunctionParameter') {
    const node = bodyOf<Record<string, unknown>>(value)
    check(source.identifierAt(typeof node.location === 'number' ? node.location : undefined, String(node.name ?? '')))
  } else if (kind === 'RangeSubselect') {
    const node = bodyOf<Record<string, unknown>>(value)
    if (node.alias) checkAlias(source.aliasAfterExpression(source.span(node.subquery)?.end ?? 0), check)
  } else if (kind === 'RangeFunction') {
    const node = bodyOf<Record<string, unknown>>(value)
    if (node.alias) checkAlias(source.aliasAfterExpression(source.span(node.functions)?.end ?? 0), check)
  } else if (kind === 'JoinExpr') {
    const node = bodyOf<Record<string, unknown>>(value)
    if (node.alias) checkAlias(source.aliasAfterExpression(source.span(value)?.end ?? 0), check)
  } else if (kind === 'IndexStmt') {
    const node = bodyOf<Record<string, unknown>>(value)
    const relation = relationLocation(node.relation)
    if (typeof node.idxname === 'string') check(source.identifierBefore(relation, node.idxname))
    checkIndexParams(node.indexParams, source, check, relation)
  }

  const body = bodyOf<Record<string, unknown> | undefined>(value)
  if (!body) return
  for (const child of Object.values(body)) checkNode(child, source, check)
}

/** Check a constraint's names and key columns. */
function checkConstraint(
  node: Record<string, unknown>,
  source: SqlSource,
  check: (raw: string | undefined) => void,
): void {
  const position = typeof node.location === 'number' ? node.location : 0
  if (typeof node.conname === 'string') check(source.identifierNear(position, node.conname))
  checkNames(node.keys, position, source, check)
  checkNames(node.fk_attrs, position, source, check)
  const pktable = node.pktable
  const pkPosition = pktable && typeof pktable === 'object'
    ? Number((pktable as { location?: unknown }).location ?? 0)
    : position
  checkNames(node.pk_attrs, pkPosition, source, check)
}

/** Check an array of String key nodes. */
function checkNames(
  values: unknown,
  position: number,
  source: SqlSource,
  check: (raw: string | undefined) => void,
): void {
  if (!Array.isArray(values)) return
  for (const value of values) check(source.identifierNear(position, String(bodyOf<{ sval?: string }>(value).sval ?? '')))
}

/** Read an index relation's source location, accepting a plain or wrapped RangeVar. */
function relationLocation(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const direct = (value as { location?: unknown }).location
  if (typeof direct === 'number') return direct
  const wrapped = (value as { RangeVar?: { location?: unknown } }).RangeVar
  return wrapped && typeof wrapped.location === 'number' ? wrapped.location : 0
}

/** Check index parameter names within the index's own parenthesized list. */
function checkIndexParams(
  values: unknown,
  source: SqlSource,
  check: (raw: string | undefined) => void,
  relation: number,
): void {
  if (!Array.isArray(values)) return
  const open = source.tokens.find(token => token.start >= relation && token.text === '(')
  let cursor = open?.end ?? relation
  for (const value of values) {
    if (kindOf(value) !== 'IndexElem') continue
    const node = bodyOf<Record<string, unknown>>(value)
    if (typeof node.name === 'string') {
      const token = source.tokenNear(cursor, node.name)
      if (token) {
        check(token.text)
        cursor = token.end
      } else {
        check(node.name)
      }
    } else {
      cursor = afterElement(cursor, source)
    }
  }
}

/** Advance past one index element expression. */
function afterElement(position: number, source: SqlSource): number {
  let depth = 0
  for (const token of source.tokens) {
    if (token.start < position) continue
    if (token.text === '(' || token.text === '[') depth += 1
    else if (token.text === ')' || token.text === ']') {
      if (depth === 0) return token.end
      depth -= 1
    } else if (token.text === ',' && depth === 0) return token.end
  }
  return position
}

/** Check an expression alias and its column aliases. */
function checkAlias(
  alias: { columns: readonly string[], name?: string },
  check: (raw: string | undefined) => void,
): void {
  check(alias.name)
  for (const column of alias.columns) check(column)
}
