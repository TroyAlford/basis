/* eslint-disable @stylistic/max-len -- SQL fixtures and protocol field names need long lines. */
/* eslint-disable camelcase */
import type { Node } from 'libpg-query'
import type { SqlDoc } from './doc'
import { concat, group, hardline, indent, join, line, softline, text } from './doc'
import type { PrintContext } from './printer'
import type { SourceAlias } from './source'
import type { PgKind, PgNode } from './types'
import { bodyOf, booleanValue, kindOf, stringValue, stringValues, tagNode, UnsupportedNodeError } from './types'

/** The value carried by one node kind. */
export type ValueOf<K extends PgKind> = Extract<PgNode, { kind: K }>['value']

/** Empty document. */
export const empty = text('')

/** Built-in SQL functions formatted with canonical uppercase names. */
const BUILTIN_FUNCTIONS = new Set([
  'abs', 'aclexplode', 'array_agg', 'array_length', 'array_position', 'array_remove',
  'array_to_string', 'avg', 'bool_and', 'bool_or', 'cardinality', 'chr', 'coalesce', 'concat',
  'count', 'current_database', 'current_schema', 'current_schemas', 'current_setting', 'date_part',
  'date_trunc', 'format', 'generate_series', 'gen_random_uuid', 'greatest', 'has_column_privilege',
  'has_schema_privilege', 'has_table_privilege', 'hashtext', 'json_agg', 'json_build_object',
  'jsonb_agg', 'jsonb_build_object', 'jsonb_set', 'least', 'length', 'lower', 'make_interval',
  'max', 'md5', 'min', 'now', 'nullif', 'pg_advisory_xact_lock', 'pg_get_constraintdef',
  'pg_get_function_identity_arguments', 'pg_get_functiondef', 'pg_get_indexdef',
  'pg_get_serial_sequence', 'pg_get_triggerdef', 'pg_get_userbyid', 'position', 'random',
  'regexp_replace', 'round', 'row_to_json', 'session_user', 'set_config', 'setweight', 'split_part',
  'string_agg', 'string_to_array', 'substring', 'sum', 'to_char', 'to_date', 'to_json', 'to_jsonb',
  'to_regclass', 'to_regprocedure', 'to_timestamp', 'to_tsvector', 'transaction_timestamp', 'trim',
  'unaccent', 'unnest', 'upper', 'user',
])

/**
 * Quote an identifier.
 *
 * The formatter quotes every identifier position so folded source spellings do
 * not silently change case-sensitive identity and so canonical output is
 * independent of how an identifier happened to be written.
 * @param name
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/gu, '""')}"`
}

/**
 * Quote an exact source identifier component, preserving existing quotes.
 * @param source
 */
export function quoteSourceIdentifier(source: string): string {
  return source.startsWith('"') && source.endsWith('"') ? source : quoteIdentifier(source)
}

/**
 * Quote an exact source identifier unless it is an opaque interpolation marker.
 * @param source
 * @param ctx
 */
export function quotePart(source: string, ctx: PrintContext): string {
  const raw = source.startsWith('"') && source.endsWith('"')
    ? source.slice(1, -1).replace(/""/gu, '"')
    : source
  return ctx.opaque.has(raw) ? source : quoteSourceIdentifier(source)
}

/**
 * Print a function name: built-ins uppercase, user-defined names lowercase and unquoted.
 * @param names
 */
export function functionName(names: readonly string[]): string {
  const last = (names[names.length - 1] ?? '').toLowerCase()
  if (BUILTIN_FUNCTIONS.has(last)) return last.toUpperCase()
  return names.map(name => (
    /^[a-z_][a-z0-9_$]*$/u.test(name) ? name.toLowerCase() : quoteIdentifier(name)
  )).join('.')
}

/**
 * Quote a string literal for synthesized output.
 * @param value
 */
export function quoteString(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`
}

/**
 * Parenthesize a document.
 * @param doc
 */
export function paren(doc: SqlDoc): SqlDoc {
  return concat(text('('), doc, text(')'))
}

const TYPE_NAMES: Record<string, string> = {
  bigint: 'BIGINT',
  bit: 'BIT',
  bool: 'BOOLEAN',
  bpchar: 'CHAR',
  bytea: 'BYTEA',
  date: 'DATE',
  float4: 'REAL',
  float8: 'DOUBLE PRECISION',
  int2: 'SMALLINT',
  int4: 'INTEGER',
  int8: 'BIGINT',
  interval: 'INTERVAL',
  json: 'JSON',
  jsonb: 'JSONB',
  name: 'NAME',
  numeric: 'NUMERIC',
  oid: 'OID',
  record: 'RECORD',
  text: 'TEXT',
  time: 'TIME',
  timestamp: 'TIMESTAMP',
  timestamptz: 'TIMESTAMP WITH TIME ZONE',
  timetz: 'TIME WITH TIME ZONE',
  trigger: 'TRIGGER',
  uuid: 'UUID',
  varbit: 'BIT VARYING',
  varchar: 'VARCHAR',
  void: 'VOID',
}

/**
 * Print a PostgreSQL type name.
 * @param node
 * @param ctx
 */
export function printTypeName(node: ValueOf<'TypeName'>, ctx: PrintContext): SqlDoc {
  const names = stringValues(node.names)
  const standard = standardTypeName(names)
  const base = standard === null
    ? names.map(quoteIdentifier).join('.')
    : standard
  const typmods = (node.typmods ?? []).map(ctx.print)
  const modifiers = typmods.length === 0
    ? empty
    : concat(text('('), join(text(', '), typmods), text(')'))
  const bounds = (node.arrayBounds ?? []).map(() => text('[]'))
  const setof = node.setof ? text('SETOF ') : empty
  return concat(setof, text(base), modifiers, ...bounds)
}

/**
 * Resolve a built-in type name, accepting an explicit pg_catalog qualification.
 * @param names
 */
function standardTypeName(names: readonly string[]): string | null {
  if (names.length === 1) return TYPE_NAMES[names[0] as string] ?? null
  if (names.length === 2 && names[0] === 'pg_catalog') return TYPE_NAMES[names[1] as string] ?? null
  return null
}

const OPERATOR_PRECEDENCE: Record<string, number> = {
  '!=': 40,
  '!~~': 50,
  '!~~*': 50,
  '#-': 60,
  '#>': 60,
  '#>>': 60,
  '%': 80,
  '&&': 60,
  '*': 80,
  '+': 70,
  '-': 70,
  '->': 60,
  '->>': 60,
  '/': 80,
  '<': 40,
  '<=': 40,
  '<>': 40,
  '<@': 60,
  '=': 40,
  '>': 40,
  '>=': 40,
  '?': 60,
  '?&': 60,
  '?|': 60,
  '@>': 60,
  '^': 90,
  '||': 60,
  '~~': 50,
  '~~*': 50,
}

/**
 * The binding strength of an expression, used to decide parenthesization.
 * @param node
 */
export function precedenceOf(node: Node): number {
  const tagged = tagNode(node)
  switch (tagged.kind) {
    case 'A_Expr': {
      const value = tagged.value
      if (value.kind === 'AEXPR_BETWEEN' || value.kind === 'AEXPR_NOT_BETWEEN'
        || value.kind === 'AEXPR_BETWEEN_SYM' || value.kind === 'AEXPR_NOT_BETWEEN_SYM'
        || value.kind === 'AEXPR_IN' || value.kind === 'AEXPR_LIKE' || value.kind === 'AEXPR_ILIKE') {
        return 45
      }
      if (value.kind === 'AEXPR_DISTINCT' || value.kind === 'AEXPR_NOT_DISTINCT') return 40
      if (value.kind !== 'AEXPR_OP') return 45
      const operator = stringValues(value.name)[0] ?? ''
      return value.lexpr === undefined ? 85 : OPERATOR_PRECEDENCE[operator] ?? 60
    }
    case 'BoolExpr':
      return tagged.value.boolop === 'NOT_EXPR' ? 20 : tagged.value.boolop === 'AND_EXPR' ? 10 : 5
    case 'BooleanTest':
    case 'NullTest':
      return 30
    case 'CollateClause':
      return 96
    case 'TypeCast':
      return 95
    default:
      return 100
  }
}

/**
 * Print a child, parenthesizing it when its precedence would otherwise change meaning.
 * @param node
 * @param parent
 * @param side
 * @param ctx
 * @param associative
 */
export function childDoc(node: Node, parent: number, side: 'left' | 'right', ctx: PrintContext, associative = false): SqlDoc {
  const doc = ctx.print(node)
  const child = precedenceOf(node)
  if (child < parent) return paren(doc)
  if (child > parent) return doc
  if (associative) return doc
  if (side === 'right') return paren(doc)
  return doc
}

/**
 * Print an expression node.
 * @param node
 * @param ctx
 */
export function printExpression(node: PgNode, ctx: PrintContext): SqlDoc {
  switch (node.kind) {
    case 'ColumnRef':
      return printColumn(node.value, ctx)
    case 'A_Star':
      return text('*')
    case 'A_Const':
      return printConstant(node.value, ctx)
    case 'ParamRef':
      return text(`$${node.value.number ?? 0}`)
    case 'Integer':
      return text(String(node.value.ival ?? 0))
    case 'Float':
      return text(String(node.value.fval ?? ''))
    case 'String':
      return text(quoteString(node.value.sval ?? ''))
    case 'A_Expr':
      return printAExpr(node.value, ctx)
    case 'BoolExpr':
      return printBoolExpr(node.value, ctx)
    case 'NullTest':
      return printNullTest(node.value, ctx)
    case 'BooleanTest':
      return printBooleanTest(node.value, ctx)
    case 'TypeCast':
      return printTypeCast(node.value, ctx)
    case 'CollateClause':
      return printCollate(node.value, ctx)
    case 'FuncCall':
      return printFuncCall(node.value, ctx)
    case 'CaseExpr':
      return printCase(node.value, ctx)
    case 'CoalesceExpr':
      return printCoalesce(node.value, ctx)
    case 'A_ArrayExpr':
      return printArray(node.value, ctx)
    case 'SubLink':
      return printSubLink(node.value, ctx)
    case 'List':
      return printList(node.value, ctx)
    case 'RowExpr':
      return printRowExpr(node.value, ctx)
    case 'SQLValueFunction':
      return printSQLValueFunction(node.value)
    case 'NamedArgExpr':
      return printNamedArg(node.value, ctx)
    case 'SetToDefault':
      return text('DEFAULT')
    case 'MinMaxExpr':
      return printMinMax(node.value, ctx)
    default:
      throw new UnsupportedNodeError(node.kind)
  }
}

/**
 * Print a column reference, preserving the exact source spelling.
 * @param node
 * @param ctx
 */
function printColumn(node: ValueOf<'ColumnRef'>, ctx: PrintContext): SqlDoc {
  const fields = node.fields ?? []
  const names = fields.filter(field => kindOf(field) === 'String').map(stringValue)
  const star = fields.some(field => kindOf(field) === 'A_Star')
  if (names.length === fields.length) {
    return text(columnParts(node, names, ctx))
  }
  if (star && names.length === fields.length - 1) {
    const base = names.length === 0 ? '' : columnParts(node, names, ctx)
    return text(base === '' ? '*' : `${base}.*`)
  }
  throw new UnsupportedNodeError('ColumnRef', 'non-name field')
}

/** Quote a column reference, resolving a FROM alias case-insensitively. */
function columnParts(node: ValueOf<'ColumnRef'>, names: readonly string[], ctx: PrintContext): string {
  const parts = ctx.source.qualifiedParts(node.location, names)
  const first = parts[0]
  if (parts.length > 1 && first !== undefined) {
    const folded = unquoteIdentifier(first).toLowerCase()
    const relation = ctx.relations.get(folded)
    if (relation !== undefined) parts[0] = relation
  }
  return parts.map(part => quotePart(part, ctx)).join('.')
}

/** Remove surrounding double quotes from a source identifier. */
function unquoteIdentifier(source: string): string {
  return source.startsWith('"') && source.endsWith('"')
    ? source.slice(1, -1).replace(/""/gu, '"')
    : source
}

/**
 * Print a literal, preferring the exact source token.
 * @param node
 * @param ctx
 */
function printConstant(node: ValueOf<'A_Const'>, ctx: PrintContext): SqlDoc {
  if (node.ival !== undefined) {
    const fallback = String(node.ival.ival ?? 0)
    const token = ctx.source.tokenAt(node.location)
    return text(token && token.text !== '-' && token.text !== '+' ? token.text : fallback)
  }
  if (node.fval !== undefined) {
    const fallback = String(node.fval.fval ?? '')
    const token = ctx.source.tokenAt(node.location)
    return text(token && token.text !== '-' && token.text !== '+' ? token.text : fallback)
  }
  if (node.sval !== undefined) {
    const fallback = quoteString(node.sval.sval ?? '')
    return text(ctx.source.atom(node.location, fallback))
  }
  if (node.bsval !== undefined) {
    const fallback = `B'${node.bsval.bsval ?? ''}'`
    return text(ctx.source.atom(node.location, fallback))
  }
  if (node.boolval !== undefined) {
    return text(ctx.source.atom(node.location, booleanValue({ Boolean: node.boolval }) ? 'true' : 'false'))
  }
  if (node.isnull) return text(ctx.source.atom(node.location, 'NULL'))
  throw new UnsupportedNodeError('A_Const')
}

/**
 * Print a binary, unary, IN/LIKE/BETWEEN, or DISTINCT expression.
 * @param node
 * @param ctx
 */
function printAExpr(node: ValueOf<'A_Expr'>, ctx: PrintContext): SqlDoc {
  const operator = stringValues(node.name)[0] ?? ''
  switch (node.kind) {
    case 'AEXPR_OP': {
      if (node.lexpr === undefined) {
        const operand = ctx.print(node.rexpr as Node)
        return concat(text(operator), operand)
      }
      if (operator === '||') return printConcatChain({ A_Expr: node } as Node, ctx)
      const precedence = OPERATOR_PRECEDENCE[operator] ?? 60
      const associative = operator === 'AND' || operator === 'OR'
      return concat(
        childDoc(node.lexpr, precedence, 'left', ctx, associative),
        text(` ${operator} `),
        childDoc(node.rexpr as Node, precedence, 'right', ctx, associative),
      )
    }
    case 'AEXPR_IN': {
      const list = node.rexpr as Node
      const keyword = operator === '<>' ? ' NOT IN ' : ' IN '
      return concat(childDoc(node.lexpr as Node, 45, 'left', ctx), text(keyword), printListItems(list, ctx))
    }
    case 'AEXPR_LIKE':
    case 'AEXPR_ILIKE': {
      const keyword = node.kind === 'AEXPR_ILIKE' ? 'ILIKE' : 'LIKE'
      const negative = operator.startsWith('!')
      return concat(
        childDoc(node.lexpr as Node, 45, 'left', ctx),
        text(` ${negative ? 'NOT ' : ''}${keyword} `),
        childDoc(node.rexpr as Node, 45, 'right', ctx),
      )
    }
    case 'AEXPR_BETWEEN':
    case 'AEXPR_NOT_BETWEEN':
    case 'AEXPR_BETWEEN_SYM':
    case 'AEXPR_NOT_BETWEEN_SYM': {
      const negative = node.kind === 'AEXPR_NOT_BETWEEN' || node.kind === 'AEXPR_NOT_BETWEEN_SYM'
      const symmetric = node.kind === 'AEXPR_BETWEEN_SYM' || node.kind === 'AEXPR_NOT_BETWEEN_SYM'
      const list = bodyOf<{ items?: Node[] }>(node.rexpr)
      const items = list.items ?? []
      if (items.length !== 2) throw new UnsupportedNodeError('A_Expr', 'BETWEEN bounds')
      return concat(
        childDoc(node.lexpr as Node, 45, 'left', ctx),
        text(` ${negative ? 'NOT ' : ''}BETWEEN ${symmetric ? 'SYMMETRIC ' : ''}`),
        ctx.print(items[0] as Node),
        text(' AND '),
        ctx.print(items[1] as Node),
      )
    }
    case 'AEXPR_DISTINCT':
    case 'AEXPR_NOT_DISTINCT': {
      const negative = node.kind === 'AEXPR_NOT_DISTINCT'
      return concat(
        childDoc(node.lexpr as Node, 40, 'left', ctx),
        text(` IS ${negative ? 'NOT ' : ''}DISTINCT FROM `),
        childDoc(node.rexpr as Node, 40, 'right', ctx),
      )
    }
    default:
      throw new UnsupportedNodeError('A_Expr', String(node.kind))
  }
}

/**
 * Print a `||` chain, breaking before each operator when it does not fit.
 * @param node
 * @param ctx
 */
function printConcatChain(node: Node, ctx: PrintContext): SqlDoc {
  const operands = flattenConcat(node)
  if (operands.length === 1) return ctx.print(operands[0] as Node)
  return group(concat(
    ctx.print(operands[0] as Node),
    indent(concat(...operands.slice(1).map(operand => concat(line(), text('|| '), ctx.print(operand))))),
  ))
}

/**
 * Flatten nested `||` expressions without reordering them.
 * @param node
 */
function flattenConcat(node: Node): Node[] {
  const tagged = tagNode(node)
  if (tagged.kind !== 'A_Expr' || tagged.value.kind !== 'AEXPR_OP') return [node]
  if ((stringValues(tagged.value.name)[0] ?? '') !== '||') return [node]
  return [
    ...flattenConcat(tagged.value.lexpr as Node),
    ...flattenConcat(tagged.value.rexpr as Node),
  ]
}

/**
 * Print a boolean AND/OR/NOT expression.
 * @param node
 * @param ctx
 */
function printBoolExpr(node: ValueOf<'BoolExpr'>, ctx: PrintContext): SqlDoc {
  const args = node.args ?? []
  if (args.length === 0) throw new UnsupportedNodeError('BoolExpr', 'empty')
  if (node.boolop === 'NOT_EXPR') {
    return concat(text('NOT '), childDoc(args[0] as Node, 20, 'right', ctx))
  }
  const keyword = node.boolop === 'AND_EXPR' ? 'AND' : 'OR'
  const precedence = node.boolop === 'AND_EXPR' ? 10 : 5
  const children: SqlDoc[] = [childDoc(args[0] as Node, precedence, 'left', ctx, true)]
  for (const arg of args.slice(1)) {
    children.push(indent(concat(hardline(), text(`${keyword} `), childDoc(arg, precedence, 'right', ctx, true))))
  }
  return concat(...children)
}

/**
 * Print IS [NOT] NULL.
 * @param node
 * @param ctx
 */
function printNullTest(node: ValueOf<'NullTest'>, ctx: PrintContext): SqlDoc {
  const suffix = node.nulltesttype === 'IS_NULL' ? ' IS NULL' : ' IS NOT NULL'
  return concat(childDoc(node.arg as Node, 30, 'left', ctx), text(suffix))
}

/**
 * Print IS [NOT] TRUE/FALSE/UNKNOWN.
 * @param node
 * @param ctx
 */
function printBooleanTest(node: ValueOf<'BooleanTest'>, ctx: PrintContext): SqlDoc {
  const suffix = node.booltesttype === 'IS_TRUE' ? ' IS TRUE'
    : node.booltesttype === 'IS_NOT_TRUE' ? ' IS NOT TRUE'
      : node.booltesttype === 'IS_FALSE' ? ' IS FALSE'
        : node.booltesttype === 'IS_NOT_FALSE' ? ' IS NOT FALSE'
          : node.booltesttype === 'IS_UNKNOWN' ? ' IS UNKNOWN'
            : ' IS NOT UNKNOWN'
  return concat(childDoc(node.arg as Node, 30, 'left', ctx), text(suffix))
}

/**
 * Print a cast.
 * @param node
 * @param ctx
 */
function printTypeCast(node: ValueOf<'TypeCast'>, ctx: PrintContext): SqlDoc {
  const operand = childDoc(node.arg as Node, 95, 'left', ctx)
  return concat(operand, text('::'), printTypeName(node.typeName as ValueOf<'TypeName'>, ctx))
}

/**
 * Print COLLATE.
 * @param node
 * @param ctx
 */
function printCollate(node: ValueOf<'CollateClause'>, ctx: PrintContext): SqlDoc {
  const names = stringValues(node.collname).map(quoteIdentifier).join('.')
  return concat(
    childDoc(node.arg as Node, 96, 'left', ctx),
    text(' COLLATE '),
    text(names),
  )
}

/**
 * Print a function or aggregate call.
 * @param node
 * @param ctx
 */
function printFuncCall(node: ValueOf<'FuncCall'>, ctx: PrintContext): SqlDoc {
  const names = stringValues(node.funcname)
  const last = names[names.length - 1] ?? ''
  if (node.funcformat === 'COERCE_SQL_SYNTAX') return printSqlSyntaxFunction(last, node, ctx)

  const name = functionName(names)
  const args = node.args ?? []
  const inner: SqlDoc[] = []
  if (node.agg_star) {
    inner.push(text('*'))
  } else {
    if (node.agg_distinct) inner.push(text('DISTINCT '))
    inner.push(join(concat(text(','), line()), args.map(ctx.print)))
  }
  if (node.agg_order?.length) {
    inner.push(text(' ORDER BY '), join(text(', '), node.agg_order.map(ctx.print)))
  }
  let call = group(concat(
    text(name),
    text('('),
    indent(concat(softline(), ...inner)),
    softline(),
    text(')'),
  ))
  if (node.agg_filter) {
    call = concat(call, text(' FILTER (WHERE '), ctx.print(node.agg_filter as Node), text(')'))
  }
  if (node.over) {
    call = concat(call, text(' OVER '), printWindowDef(node.over, ctx))
  }
  return call
}

/**
 * Print SQL-standard function syntax that libpg-query represents as a FuncCall.
 * @param name
 * @param node
 * @param ctx
 */
function printSqlSyntaxFunction(name: string, node: ValueOf<'FuncCall'>, ctx: PrintContext): SqlDoc {
  const args = node.args ?? []
  switch (name) {
    case 'extract': {
      const first = args[0]
      const field = first === undefined
        ? ''
        : (bodyOf<{ sval?: { sval?: string } }>(first).sval?.sval ?? '').toUpperCase()
      const value = args[1] ? ctx.print(args[1] as Node) : empty
      return concat(text('EXTRACT('), text(field), text(' FROM '), value, text(')'))
    }
    case 'substring': {
      const value = args[0] ? ctx.print(args[0] as Node) : empty
      const from = args[1] ? concat(text(' FROM '), ctx.print(args[1] as Node)) : empty
      const forLength = args[2] ? concat(text(' FOR '), ctx.print(args[2] as Node)) : empty
      return concat(text('SUBSTRING('), value, from, forLength, text(')'))
    }
    case 'btrim':
    case 'ltrim':
    case 'rtrim': {
      const value = args[0] ? ctx.print(args[0] as Node) : empty
      const chars = args[1]
      if (chars === undefined) return concat(text('TRIM('), value, text(')'))
      const mode = name === 'btrim' ? 'BOTH' : name === 'ltrim' ? 'LEADING' : 'TRAILING'
      return concat(text(`TRIM(${mode} `), ctx.print(chars as Node), text(' FROM '), value, text(')'))
    }
    case 'position': {
      const needle = args[0] ? ctx.print(args[0] as Node) : empty
      const haystack = args[1] ? ctx.print(args[1] as Node) : empty
      return concat(text('POSITION('), needle, text(' IN '), haystack, text(')'))
    }
    case 'overlay': {
      const value = args[0] ? ctx.print(args[0] as Node) : empty
      const replacement = args[1] ? ctx.print(args[1] as Node) : empty
      const start = args[2] ? ctx.print(args[2] as Node) : empty
      const length = args[3] ? concat(text(' FOR '), ctx.print(args[3] as Node)) : empty
      return concat(text('OVERLAY('), value, text(' PLACING '), replacement, text(' FROM '), start, length, text(')'))
    }
    default:
      throw new UnsupportedNodeError('FuncCall', `SQL syntax function ${name}`)
  }
}

/**
 * Print a window definition.
 * @param node
 * @param ctx
 */
export function printWindowDef(node: ValueOf<'WindowDef'>, ctx: PrintContext): SqlDoc {
  if (node.frameOptions !== undefined && node.frameOptions !== 0 && node.frameOptions !== 1058) {
    throw new UnsupportedNodeError('WindowDef', 'frame options')
  }
  const parts: SqlDoc[] = []
  if (node.name) parts.push(text(`"${node.name}"`))
  if (node.partitionClause?.length) {
    parts.push(concat(text('PARTITION BY '), join(text(', '), node.partitionClause.map(ctx.print))))
  }
  if (node.orderClause?.length) {
    parts.push(concat(text('ORDER BY '), join(text(', '), node.orderClause.map(ctx.print))))
  }
  if (parts.length === 0) return text('()')
  return group(concat(text('('), indent(concat(softline(), join(line(), parts))), softline(), text(')')))
}

/**
 * Print CASE.
 * @param node
 * @param ctx
 */
function printCase(node: ValueOf<'CaseExpr'>, ctx: PrintContext): SqlDoc {
  const head = node.arg ? concat(text('CASE '), ctx.print(node.arg as Node)) : text('CASE')
  const whens = (node.args ?? []).map(argument => {
    const clause = bodyOf<ValueOf<'CaseWhen'>>(argument)
    return concat(
      text('WHEN '),
      ctx.print(clause.expr as Node),
      text(' THEN '),
      ctx.print(clause.result as Node),
    )
  })
  const clauses: SqlDoc[] = [...whens]
  if (node.defresult) clauses.push(concat(text('ELSE '), ctx.print(node.defresult as Node)))
  return concat(head, indent(concat(hardline(), join(hardline(), clauses))), hardline(), text('END'))
}

/**
 * Print COALESCE.
 * @param node
 * @param ctx
 */
function printCoalesce(node: ValueOf<'CoalesceExpr'>, ctx: PrintContext): SqlDoc {
  return callWithArgs('COALESCE', (node.args ?? []).map(ctx.print))
}

/**
 * Print ARRAY[...].
 * @param node
 * @param ctx
 */
function printArray(node: ValueOf<'A_ArrayExpr'>, ctx: PrintContext): SqlDoc {
  return group(concat(text('ARRAY['), join(concat(text(','), line()), (node.elements ?? []).map(ctx.print)), text(']')))
}

/**
 * Print an ARRAY/list/row argument group.
 * @param name
 * @param args
 */
function callWithArgs(name: string, args: readonly SqlDoc[]): SqlDoc {
  if (args.length === 0) return text(`${name}()`)
  return group(concat(
    text(`${name}(`),
    indent(concat(softline(), join(concat(text(','), line()), args))),
    softline(),
    text(')'),
  ))
}

/**
 * Print a sublink.
 * @param node
 * @param ctx
 */
function printSubLink(node: ValueOf<'SubLink'>, ctx: PrintContext): SqlDoc {
  const query = node.subselect ? ctx.print(node.subselect as Node) : empty
  switch (node.subLinkType) {
    case 'EXISTS_SUBLINK':
      return concat(text('EXISTS ('), indent(concat(hardline(), query)), hardline(), text(')'))
    case 'EXPR_SUBLINK':
      return concat(text('('), indent(concat(hardline(), query)), hardline(), text(')'))
    case 'ANY_SUBLINK':
      return concat(text('ANY ('), indent(concat(hardline(), query)), hardline(), text(')'))
    case 'ALL_SUBLINK':
      return concat(text('ALL ('), indent(concat(hardline(), query)), hardline(), text(')'))
    case 'ARRAY_SUBLINK':
      return concat(text('ARRAY ('), indent(concat(hardline(), query)), hardline(), text(')'))
    default:
      throw new UnsupportedNodeError('SubLink', String(node.subLinkType))
  }
}

/**
 * Print a parenthesized list.
 * @param node
 * @param ctx
 */
function printList(node: ValueOf<'List'>, ctx: PrintContext): SqlDoc {
  return group(concat(text('('), join(concat(text(','), line()), (node.items ?? []).map(ctx.print)), text(')')))
}

/**
 * Print the right side of IN, which is either a List or a sublink.
 * @param node
 * @param ctx
 */
function printListItems(node: Node, ctx: PrintContext): SqlDoc {
  if (kindOf(node) === 'SubLink') return ctx.print(node)
  if (kindOf(node) === 'List') return printList(bodyOf(node), ctx)
  return paren(ctx.print(node))
}

/**
 * Print a ROW(...) expression.
 * @param node
 * @param ctx
 */
function printRowExpr(node: ValueOf<'RowExpr'>, ctx: PrintContext): SqlDoc {
  return callWithArgs(node.row_format === 'COERCE_EXPLICIT_CALL' ? 'ROW' : '', (node.args ?? []).map(ctx.print))
}

/**
 * Print a SQL value function such as CURRENT_USER.
 * @param node
 */
function printSQLValueFunction(node: ValueOf<'SQLValueFunction'>): SqlDoc {
  const names: Record<string, string> = {
    SVFOP_CURRENT_DATE: 'CURRENT_DATE',
    SVFOP_CURRENT_ROLE: 'CURRENT_ROLE',
    SVFOP_CURRENT_SCHEMA: 'CURRENT_SCHEMA',
    SVFOP_CURRENT_TIME: 'CURRENT_TIME',
    SVFOP_CURRENT_TIMESTAMP: 'CURRENT_TIMESTAMP',
    SVFOP_CURRENT_USER: 'CURRENT_USER',
    SVFOP_LOCALTIME: 'LOCALTIME',
    SVFOP_LOCALTIMESTAMP: 'LOCALTIMESTAMP',
    SVFOP_SESSION_USER: 'SESSION_USER',
    SVFOP_USER: 'USER',
  }
  const name = names[node.op ?? '']
  if (!name) throw new UnsupportedNodeError('SQLValueFunction', String(node.op))
  return text(name)
}

/**
 * Print a named argument.
 * @param node
 * @param ctx
 */
function printNamedArg(node: ValueOf<'NamedArgExpr'>, ctx: PrintContext): SqlDoc {
  return concat(text(`${quoteIdentifier(node.name ?? '')} => `), ctx.print(node.arg as Node))
}

/**
 * Print GREATEST/LEAST.
 * @param node
 * @param ctx
 */
function printMinMax(node: ValueOf<'MinMaxExpr'>, ctx: PrintContext): SqlDoc {
  const name = node.op === 'IS_GREATEST' ? 'GREATEST' : 'LEAST'
  return callWithArgs(name, (node.args ?? []).map(ctx.print))
}

/**
 * Print a statement target (`ResTarget`).
 * @param node
 * @param ctx
 */
export function printResTarget(node: ValueOf<'ResTarget'>, ctx: PrintContext): SqlDoc {
  if (node.indirection?.length) throw new UnsupportedNodeError('ResTarget', 'indirection')
  const value = ctx.print(node.val as Node)
  if (node.name === undefined) return value
  const alias = ctx.source.aliasAfter(ctx.source.span(node.val as Node)?.start ?? 0)
  return concat(value, text(' AS '), text(alias === undefined ? quoteIdentifier(node.name) : quotePart(alias, ctx)))
}

/**
 * Print an ORDER BY item.
 * @param node
 * @param ctx
 */
export function printSortBy(
  node: ValueOf<'SortBy'>,
  ctx: PrintContext,
  aliases: ReadonlyMap<string, string> = new Map(),
): SqlDoc {
  const direction = node.sortby_dir === 'SORTBY_ASC' ? ' ASC'
    : node.sortby_dir === 'SORTBY_DESC' ? ' DESC'
      : node.sortby_dir === 'SORTBY_USING' ? ' USING ' : ''
  const nulls = node.sortby_nulls === 'SORTBY_NULLS_FIRST' ? ' NULLS FIRST'
    : node.sortby_nulls === 'SORTBY_NULLS_LAST' ? ' NULLS LAST' : ''
  return concat(printOrderNode(node.node as Node, ctx, aliases), text(direction), text(nulls))
}

/** Print an ORDER BY expression, resolving unquoted output-alias references. */
function printOrderNode(node: Node, ctx: PrintContext, aliases: ReadonlyMap<string, string>): SqlDoc {
  if (kindOf(node) === 'ColumnRef') {
    const column = bodyOf<ValueOf<'ColumnRef'>>(node)
    const fields = column.fields ?? []
    if (fields.length === 1 && kindOf(fields[0]) === 'String') {
      const name = stringValue(fields[0])
      const source = ctx.source.tokenAt(column.location)
      const alias = aliases.get(name.toLowerCase())
      if (source !== undefined && !source.text.startsWith('"') && alias !== undefined) return text(alias)
    }
  }
  return ctx.print(node)
}

/**
 * Print an alias, including its optional column list.
 * @param node
 */
export function printAlias(node: ValueOf<'Alias'>, ctx: PrintContext, source?: SourceAlias): SqlDoc {
  const aliasName = source?.name ?? node.aliasname ?? ''
  const sourceColumns = source?.columns ?? []
  const columns = sourceColumns.length > 0
    ? concat(text('('), join(text(', '), sourceColumns.map(name => text(quotePart(name, ctx)))), text(')'))
    : node.colnames?.length
      ? concat(text('('), join(text(', '), stringValues(node.colnames).map(name => text(quoteIdentifier(name)))), text(')'))
      : empty
  return concat(text(quotePart(aliasName, ctx)), columns)
}

/**
 * Print a subquery in FROM.
 * @param node
 * @param ctx
 */
export function printRangeSubselect(node: ValueOf<'RangeSubselect'>, ctx: PrintContext): SqlDoc {
  const lateral = node.lateral ? text('LATERAL ') : empty
  const sourceAlias = ctx.source.aliasAfterExpression(ctx.source.span(node.subquery as Node)?.end ?? 0)
  const alias = node.alias ? concat(text(' '), printAlias(node.alias, ctx, sourceAlias)) : empty
  return concat(
    lateral,
    text('('),
    indent(concat(hardline(), ctx.print(node.subquery as Node))),
    hardline(),
    text(')'),
    alias,
  )
}

/**
 * Print a function in FROM.
 * @param node
 * @param ctx
 */
export function printRangeFunction(node: ValueOf<'RangeFunction'>, ctx: PrintContext): SqlDoc {
  if (node.coldeflist?.length) throw new UnsupportedNodeError('RangeFunction', 'column definitions')
  const functions = (node.functions ?? []).map(entry => {
    const items = bodyOf<{ items?: Node[] }>(entry).items ?? []
    if (items.length === 0) throw new UnsupportedNodeError('RangeFunction', 'missing function')
    return ctx.print(items[0] as Node)
  })
  const sourceAlias = ctx.source.aliasAfterExpression(ctx.source.span(node.functions)?.end ?? 0)
  const alias = node.alias ? concat(text(' '), printAlias(node.alias, ctx, sourceAlias)) : empty
  return concat(
    node.lateral ? text('LATERAL ') : empty,
    join(text(', '), functions),
    node.ordinality ? text(' WITH ORDINALITY') : empty,
    alias,
  )
}

/**
 * Print a range variable, preserving source spelling.
 * @param node
 * @param ctx
 */
export function printRangeVar(node: ValueOf<'RangeVar'>, ctx: PrintContext): SqlDoc {
  const fallback = [node.catalogname, node.schemaname, node.relname]
    .filter((part): part is string => part !== undefined)
  const relation = text(ctx.source.qualifiedParts(node.location, fallback).map(part => quotePart(part, ctx)).join('.'))
  if (!node.alias) return relation
  const alias = node.alias
  const aliasName = ctx.source.relationAlias(node.location) ?? alias.aliasname ?? ''
  const columns = alias.colnames?.length
    ? concat(text('('), join(text(', '), stringValues(alias.colnames).map(name => text(quotePart(name, ctx)))), text(')'))
    : empty
  return concat(relation, text(' '), text(quotePart(aliasName, ctx)), columns)
}
