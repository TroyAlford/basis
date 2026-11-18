/* eslint-disable @stylistic/max-len -- SQL fixtures and protocol field names need long lines. */
/* eslint-disable camelcase */
import type { Node } from 'libpg-query'
import type { SqlDoc } from './doc'
import { concat, group, hardline, indent, join, line, text } from './doc'
import type { ValueOf } from './expressions'
import { empty, functionName, printRangeVar, printSortBy, printTypeName, quoteIdentifier, quotePart } from './expressions'
import type { PrintContext } from './printer'
import type { SourceText } from './source'
import { bodyOf, booleanValue, kindOf, stringValue, stringValues, UnsupportedNodeError } from './types'

/**
 * Print one named table or column.
 * @param name
 */
export function printName(name: string): SqlDoc {
  return text(quoteIdentifier(name))
}

/**
 * Print a comma-separated list of expressions.
 * @param docs
 * @param separator
 */
function list(docs: readonly SqlDoc[], separator: SqlDoc = concat(text(','), line())): SqlDoc {
  return group(join(separator, docs))
}

/**
 * Print a SELECT statement.
 * @param node
 * @param ctx
 * @param options
 * @param options.into
 */
export function printSelect(node: ValueOf<'SelectStmt'>, ctx: PrintContext, options: { into?: SqlDoc } = {}): SqlDoc {
  if (node.intoClause) throw new UnsupportedNodeError('SelectStmt', 'INTO clause')
  if (node.lockingClause?.length) throw new UnsupportedNodeError('SelectStmt', 'locking clause')
  if (node.op !== undefined && node.op !== 'SETOP_NONE') {
    const operator = node.op === 'SETOP_UNION' ? 'UNION'
      : node.op === 'SETOP_INTERSECT' ? 'INTERSECT'
        : 'EXCEPT'
    return concat(
      printSelect(node.larg as ValueOf<'SelectStmt'>, ctx),
      hardline(),
      hardline(),
      text(`${operator}${node.all ? ' ALL' : ''}`),
      hardline(),
      hardline(),
      printSelect(node.rarg as ValueOf<'SelectStmt'>, ctx),
    )
  }

  const withDoc = node.withClause ? concat(printWithClause(node.withClause, ctx), hardline()) : empty
  if (node.valuesLists?.length) {
    return concat(withDoc, printValues(node.valuesLists, ctx))
  }
  if (!node.targetList?.length) throw new UnsupportedNodeError('SelectStmt', 'missing target list')

  const previousRelations = ctx.relations
  ctx.relations = collectFromAliases(node.fromClause, ctx, new Map(previousRelations))
  let distinct = empty
  if (node.distinctClause?.length) {
    const onlyList = node.distinctClause.length === 1 && kindOf(node.distinctClause[0]) === 'List'
    distinct = text(onlyList ? ` DISTINCT ON ${listText(node.distinctClause[0] as Node)}` : ' DISTINCT')
  }
  const boundary = firstClauseStart([
    node.fromClause,
    node.whereClause ? [node.whereClause] : undefined,
    node.groupClause,
    node.sortClause,
  ], ctx) ?? ctx.statementEnd
  const targets = group(concat(
    text('SELECT'),
    distinct,
    indent(concat(
      line(),
      printTargetList(node.targetList, boundary, ctx),
      options.into ? concat(text(' INTO '), options.into) : empty,
    )),
  ))
  const parts: SqlDoc[] = [withDoc, targets]
  let previousEnd = lastNodeEnd(node.targetList, ctx.source)
  if (node.fromClause?.length) {
    pushClause(parts, 'FROM ', firstNode(node.fromClause), previousEnd, ctx, () => printFromList(node.fromClause ?? [], ctx))
    previousEnd = lastNodeEnd(node.fromClause, ctx.source)
  }
  if (node.whereClause) {
    pushClause(parts, 'WHERE ', node.whereClause as Node, previousEnd, ctx, () => ctx.print(node.whereClause as Node))
    previousEnd = ctx.source.span(node.whereClause)?.end ?? previousEnd
  }
  if (node.groupClause?.length) {
    pushClause(parts, `GROUP BY ${node.groupDistinct ? 'DISTINCT ' : ''}`, firstNode(node.groupClause), previousEnd, ctx, () => list((node.groupClause ?? []).map(ctx.print)))
    previousEnd = lastNodeEnd(node.groupClause, ctx.source)
  }
  if (node.havingClause) {
    pushClause(parts, 'HAVING ', node.havingClause as Node, previousEnd, ctx, () => ctx.print(node.havingClause as Node))
    previousEnd = ctx.source.span(node.havingClause)?.end ?? previousEnd
  }
  if (node.windowClause?.length) {
    pushClause(parts, 'WINDOW ', firstNode(node.windowClause), previousEnd, ctx, () => list((node.windowClause ?? []).map(ctx.print)))
    previousEnd = lastNodeEnd(node.windowClause, ctx.source)
  }
  if (node.sortClause?.length) {
    const aliases = outputAliases(node.targetList, ctx)
    pushClause(parts, 'ORDER BY ', firstNode(node.sortClause), previousEnd, ctx, () => list((node.sortClause ?? []).map(item => printSortBy(bodyOf<ValueOf<'SortBy'>>(item), ctx, aliases))))
    previousEnd = lastNodeEnd(node.sortClause, ctx.source)
  }
  if (node.limitCount) {
    pushClause(parts, 'LIMIT ', node.limitCount as Node, previousEnd, ctx, () => {
      const ties = node.limitOption === 'LIMIT_OPTION_WITH_TIES' ? text(' WITH TIES') : empty
      return concat(ctx.print(node.limitCount as Node), ties)
    })
    previousEnd = ctx.source.span(node.limitCount)?.end ?? previousEnd
  }
  if (node.limitOffset) {
    pushClause(parts, 'OFFSET ', node.limitOffset as Node, previousEnd, ctx, () => ctx.print(node.limitOffset as Node))
  }
  return concat(...parts)
}

/** Collect FROM aliases into a folded-name map. */
function collectFromAliases(
  nodes: readonly Node[] | undefined,
  ctx: PrintContext,
  aliases: Map<string, string>,
): Map<string, string> {
  for (const node of nodes ?? []) {
    const kind = kindOf(node)
    if (kind === 'RangeVar') {
      const relation = bodyOf<ValueOf<'RangeVar'>>(node)
      if (relation.alias) {
        const source = ctx.source.relationAlias(relation.location) ?? relation.alias.aliasname ?? ''
        aliases.set(foldedIdentifier(source), quotePart(source, ctx))
      }
    } else if (kind === 'RangeSubselect' || kind === 'RangeFunction') {
      const value = bodyOf<{ alias?: { aliasname?: string } }>(node)
      if (value.alias?.aliasname) {
        aliases.set(value.alias.aliasname.toLowerCase(), quoteIdentifier(value.alias.aliasname))
      }
    } else if (kind === 'JoinExpr') {
      const joinNode = bodyOf<ValueOf<'JoinExpr'>>(node)
      collectFromAliases([joinNode.larg as Node, joinNode.rarg as Node], ctx, aliases)
      if (joinNode.alias?.aliasname) {
        aliases.set(joinNode.alias.aliasname.toLowerCase(), quoteIdentifier(joinNode.alias.aliasname))
      }
    }
  }
  return aliases
}

/** Fold an identifier to its PostgreSQL comparison name. */
function foldedIdentifier(source: string): string {
  const identifier = source.startsWith('"') && source.endsWith('"')
    ? source.slice(1, -1).replace(/""/gu, '"')
    : source
  return identifier.toLowerCase()
}

/**
 * Print the contents of a List node as text (used for DISTINCT ON).
 * @param node
 */
function listText(node: Node): string {
  const listValue = bodyOf<{ items?: Node[] }>(node)
  const items = (listValue.items ?? []).map(item => {
    if (kindOf(item) !== 'String') throw new UnsupportedNodeError('List', 'non-name item')
    return quoteIdentifier(stringValue(item))
  })
  return `(${items.join(', ')})`
}

/**
 * Print a VALUES clause.
 * @param rows
 * @param ctx
 */
export function printValues(rows: readonly Node[], ctx: PrintContext): SqlDoc {
  return concat(
    text('VALUES'),
    indent(concat(
      hardline(),
      join(concat(text(','), hardline()), rows.map(row => group(concat(
        text('('),
        indent(join(concat(text(','), line()), (bodyOf<{ items?: Node[] }>(row).items ?? []).map(ctx.print))),
        text(')'),
      )))),
    )),
  )
}

/**
 * Print a FROM list.
 * @param items
 * @param ctx
 */
export function printFromList(items: readonly Node[], ctx: PrintContext): SqlDoc {
  return group(list(items.map(ctx.print)))
}

/**
 * Print a join expression.
 * @param node
 * @param ctx
 */
export function printJoin(node: ValueOf<'JoinExpr'>, ctx: PrintContext): SqlDoc {
  const natural = node.isNatural ? 'NATURAL ' : ''
  const kind = node.jointype === 'JOIN_LEFT' ? 'LEFT JOIN'
    : node.jointype === 'JOIN_RIGHT' ? 'RIGHT JOIN'
      : node.jointype === 'JOIN_FULL' ? 'FULL JOIN'
        : node.jointype === 'JOIN_SEMI' ? 'SEMI JOIN'
          : node.jointype === 'JOIN_ANTI' ? 'ANTI JOIN'
            : node.jointype === 'JOIN_INNER' && !node.quals && !node.usingClause?.length ? 'CROSS JOIN'
              : 'JOIN'
  const using = node.usingClause?.length
    ? concat(text(' USING ('), join(text(', '), stringValues(node.usingClause).map(name => text(quoteIdentifier(name)))), text(')'))
    : empty
  const on = node.quals ? concat(text(' ON '), ctx.print(node.quals)) : empty
  const alias = node.alias
    ? concat(text(' '), text(quoteIdentifier(node.alias.aliasname ?? '')))
    : empty
  return concat(
    ctx.print(node.larg as Node),
    hardline(),
    text(`${natural}${kind} `),
    ctx.print(node.rarg as Node),
    alias,
    using,
    on,
  )
}

/**
 * Print a WITH clause.
 * @param node
 * @param ctx
 */
export function printWithClause(node: ValueOf<'WithClause'>, ctx: PrintContext): SqlDoc {
  if (!node.ctes?.length) throw new UnsupportedNodeError('WithClause', 'empty')
  const ctes = node.ctes.map(cte => printCommonTableExpr(bodyOf(cte), ctx))
  return concat(
    text(`WITH${node.recursive ? ' RECURSIVE' : ''} `),
    join(concat(text(','), hardline()), ctes),
  )
}

/**
 * Print one common table expression.
 * @param node
 * @param ctx
 */
export function printCommonTableExpr(node: ValueOf<'CommonTableExpr'>, ctx: PrintContext): SqlDoc {
  if (node.search_clause || node.cycle_clause) {
    throw new UnsupportedNodeError('CommonTableExpr', 'search/cycle clause')
  }
  const columns = node.aliascolnames?.length
    ? concat(text('('), join(text(', '), stringValues(node.aliascolnames).map(name => text(quoteIdentifier(name)))), text(') '))
    : empty
  const materialized = node.ctematerialized === 'CTEMaterializeAlways' ? 'MATERIALIZED '
    : node.ctematerialized === 'CTEMaterializeNever' ? 'NOT MATERIALIZED '
      : ''
  const queryStart = ctx.source.span(node.ctequery as Node)?.start ?? 0
  return concat(
    text(ctx.source.quotedIdentifierBefore(queryStart, node.ctename ?? '')),
    columns,
    text(` AS ${materialized}(`),
    indent(concat(hardline(), ctx.print(node.ctequery as Node))),
    hardline(),
    text(')'),
  )
}

/**
 * Print an INSERT statement.
 * @param node
 * @param ctx
 */
export function printInsert(node: ValueOf<'InsertStmt'>, ctx: PrintContext): SqlDoc {
  const parts: SqlDoc[] = []
  if (node.withClause) parts.push(printWithClause(node.withClause, ctx), hardline())
  parts.push(text('INSERT INTO '), ctx.print({ RangeVar: node.relation } as Node))
  if (node.cols?.length) {
    parts.push(text(' ('), join(text(', '), node.cols.map(column => {
      const target = bodyOf<ValueOf<'ResTarget'>>(column)
      if (target.name === undefined) throw new UnsupportedNodeError('InsertStmt', 'column target')
      return text(quotePart(ctx.source.identifierAt(target.location, target.name), ctx))
    })), text(')'))
  }
  if (node.override === 'OVERRIDING_SYSTEM_VALUE') parts.push(text(' OVERRIDING SYSTEM VALUE'))
  if (node.override === 'OVERRIDING_USER_VALUE') parts.push(text(' OVERRIDING USER VALUE'))
  const source = node.selectStmt as Node
  if (kindOf(source) === 'SelectStmt' && bodyOf<ValueOf<'SelectStmt'>>(source).valuesLists?.length) {
    parts.push(hardline(), printValues((bodyOf<ValueOf<'SelectStmt'>>(source).valuesLists) as Node[], ctx))
  } else {
    parts.push(hardline(), ctx.print(source))
  }
  if (node.onConflictClause) parts.push(hardline(), printOnConflict(node.onConflictClause, ctx))
  if (node.returningClause) parts.push(hardline(), printReturning(node.returningClause, ctx))
  return concat(...parts)
}

/**
 * Print an ON CONFLICT clause.
 * @param node
 * @param ctx
 */
function printOnConflict(node: ValueOf<'OnConflictClause'>, ctx: PrintContext): SqlDoc {
  const parts: SqlDoc[] = [text('ON CONFLICT')]
  if (node.infer) {
    const infer = node.infer
    if (infer.conname) parts.push(text(' ON CONSTRAINT '), text(quoteIdentifier(infer.conname)))
    else if (infer.indexElems?.length) {
      parts.push(text(' ('), list(infer.indexElems.map(ctx.print), text(', ')), text(')'))
      if (infer.whereClause) parts.push(text(' WHERE '), ctx.print(infer.whereClause))
    }
  }
  if (node.action === 'ONCONFLICT_NOTHING') {
    parts.push(text(' DO NOTHING'))
  } else if (node.action === 'ONCONFLICT_UPDATE') {
    if (!node.targetList?.length) throw new UnsupportedNodeError('OnConflictClause', 'missing SET list')
    parts.push(
      text(' DO UPDATE SET '),
      list(node.targetList.map(assignment => printAssignment(bodyOf<ValueOf<'ResTarget'>>(assignment), ctx))),
    )
    if (node.whereClause) parts.push(text(' WHERE '), ctx.print(node.whereClause))
  } else {
    throw new UnsupportedNodeError('OnConflictClause', String(node.action))
  }
  return concat(...parts)
}

/**
 * Print RETURNING.
 * @param node
 * @param ctx
 */
function printReturning(node: ValueOf<'ReturningClause'>, ctx: PrintContext): SqlDoc {
  if (node.options?.length) throw new UnsupportedNodeError('ReturningClause', 'options')
  return concat(text('RETURNING '), list((node.exprs ?? []).map(ctx.print)))
}

/**
 * Print one UPDATE assignment.
 * @param node
 * @param ctx
 */
function printAssignment(node: ValueOf<'ResTarget'>, ctx: PrintContext): SqlDoc {
  if (node.name === undefined) throw new UnsupportedNodeError('ResTarget', 'assignment name')
  return concat(text(quotePart(ctx.source.identifierAt(node.location, node.name), ctx)), text(' = '), ctx.print(node.val as Node))
}

/**
 * Print an UPDATE statement.
 * @param node
 * @param ctx
 */
export function printUpdate(node: ValueOf<'UpdateStmt'>, ctx: PrintContext): SqlDoc {
  const parts: SqlDoc[] = []
  if (node.withClause) parts.push(printWithClause(node.withClause, ctx), hardline())
  parts.push(text('UPDATE '), ctx.print({ RangeVar: node.relation } as Node))
  if (!node.targetList?.length) throw new UnsupportedNodeError('UpdateStmt', 'missing SET list')
  parts.push(
    hardline(),
    group(concat(text('SET'), indent(concat(line(), list(node.targetList.map(assignment => printAssignment(bodyOf<ValueOf<'ResTarget'>>(assignment), ctx))))))),
  )
  if (node.fromClause?.length) parts.push(hardline(), text('FROM '), printFromList(node.fromClause, ctx))
  if (node.whereClause) parts.push(hardline(), text('WHERE '), ctx.print(node.whereClause))
  if (node.returningClause) parts.push(hardline(), printReturning(node.returningClause, ctx))
  return concat(...parts)
}

/**
 * Print a DELETE statement.
 * @param node
 * @param ctx
 */
export function printDelete(node: ValueOf<'DeleteStmt'>, ctx: PrintContext): SqlDoc {
  const parts: SqlDoc[] = []
  if (node.withClause) parts.push(printWithClause(node.withClause, ctx), hardline())
  parts.push(text('DELETE FROM '), ctx.print({ RangeVar: node.relation } as Node))
  if (node.usingClause?.length) parts.push(hardline(), text('USING '), printFromList(node.usingClause, ctx))
  if (node.whereClause) parts.push(hardline(), text('WHERE '), ctx.print(node.whereClause))
  if (node.returningClause) parts.push(hardline(), printReturning(node.returningClause, ctx))
  return concat(...parts)
}

/**
 * Print CREATE TABLE.
 * @param node
 * @param ctx
 */
export function printCreateStmt(node: ValueOf<'CreateStmt'>, ctx: PrintContext): SqlDoc {
  if (node.partbound) throw new UnsupportedNodeError('CreateStmt', 'partition bound')
  if (node.ofTypename) throw new UnsupportedNodeError('CreateStmt', 'OF type')
  const relation = node.relation as ValueOf<'RangeVar'>
  const persistence = relation.relpersistence === 'u' ? 'UNLOGGED '
    : relation.relpersistence === 't' ? 'TEMPORARY '
      : ''
  const elements: Node[] = [...(node.tableElts ?? []), ...(node.constraints ?? [])]
  if (elements.length === 0) throw new UnsupportedNodeError('CreateStmt', 'empty table')
  const relationEnd = ctx.source.span(relation)?.end ?? 0
  const lastEnd = ctx.source.span(elements[elements.length - 1] as Node)?.end ?? relationEnd
  const close = ctx.source.tokens.find(token => token.start >= lastEnd && token.text === ')')?.start ?? lastEnd
  const parts: SqlDoc[] = [
    text(`CREATE ${persistence}TABLE ${node.if_not_exists ? 'IF NOT EXISTS ' : ''}`),
    printRangeVar(relation, ctx),
    text(' ('),
    indent(concat(hardline(), printCommaList(elements, ctx, relationEnd, close))),
    hardline(),
    text(')'),
  ]
  if (node.inhRelations?.length) {
    parts.push(text(' INHERITS ('), join(text(', '), node.inhRelations.map(ctx.print)), text(')'))
  }
  if (node.partspec) parts.push(text(' '), printPartitionSpec(node.partspec, ctx))
  if (node.accessMethod) parts.push(text(` USING ${quoteIdentifier(node.accessMethod)}`))
  if (node.tablespacename) parts.push(text(` TABLESPACE ${quoteIdentifier(node.tablespacename)}`))
  if (node.options?.length) parts.push(text(' WITH ('), printDefElems(node.options, ctx), text(')'))
  if (node.oncommit === 'ONCOMMIT_DROP') parts.push(text(' ON COMMIT DROP'))
  if (node.oncommit === 'ONCOMMIT_DELETE_ROWS') parts.push(text(' ON COMMIT DELETE ROWS'))
  if (node.oncommit === 'ONCOMMIT_PRESERVE_ROWS') parts.push(text(' ON COMMIT PRESERVE ROWS'))
  return concat(...parts)
}

/**
 * Print a partition specification.
 * @param node
 * @param ctx
 */
function printPartitionSpec(node: ValueOf<'PartitionSpec'>, ctx: PrintContext): SqlDoc {
  const strategy = node.strategy === 'PARTITION_STRATEGY_RANGE' ? 'RANGE'
    : node.strategy === 'PARTITION_STRATEGY_LIST' ? 'LIST'
      : 'HASH'
  return concat(text(`PARTITION BY ${strategy} (`), join(text(', '), (node.partParams ?? []).map(ctx.print)), text(')'))
}

/**
 * Print a column definition.
 * @param node
 * @param ctx
 */
export function printColumnDef(node: ValueOf<'ColumnDef'>, ctx: PrintContext): SqlDoc {
  if (node.compression) throw new UnsupportedNodeError('ColumnDef', 'compression')
  if (node.storage) throw new UnsupportedNodeError('ColumnDef', 'storage')
  const parts: SqlDoc[] = [
    text(quotePart(ctx.source.identifierAt(node.location, node.colname ?? ''), ctx)),
    text(' '),
    printTypeName(node.typeName as ValueOf<'TypeName'>, ctx),
  ]
  if (node.collClause) parts.push(text(' '), ctx.print({ CollateClause: node.collClause } as Node))
  if (node.is_not_null) parts.push(text(' NOT NULL'))
  if (node.raw_default) parts.push(text(' DEFAULT '), ctx.print(node.raw_default as Node))
  for (const constraint of node.constraints ?? []) {
    parts.push(text(' '), ctx.print(constraint))
  }
  return concat(...parts)
}

/** Constraint keywords. */
const CONSTRAINT_KEYWORDS: Record<string, string> = {
  CONSTR_ATTR_DEFERRABLE: 'DEFERRABLE',
  CONSTR_ATTR_DEFERRED: 'INITIALLY DEFERRED',
  CONSTR_ATTR_IMMEDIATE: 'INITIALLY IMMEDIATE',
  CONSTR_ATTR_NOT_DEFERRABLE: 'NOT DEFERRABLE',
  CONSTR_CHECK: 'CHECK',
  CONSTR_DEFAULT: 'DEFAULT',
  CONSTR_EXCLUSION: 'EXCLUDE',
  CONSTR_FOREIGN: 'FOREIGN KEY',
  CONSTR_GENERATED: 'GENERATED',
  CONSTR_IDENTITY: 'GENERATED',
  CONSTR_NOTNULL: 'NOT NULL',
  CONSTR_NULL: 'NULL',
  CONSTR_PRIMARY: 'PRIMARY KEY',
  CONSTR_UNIQUE: 'UNIQUE',
}

/**
 * Print a table or column constraint.
 * @param node
 * @param ctx
 */
export function printConstraint(node: ValueOf<'Constraint'>, ctx: PrintContext): SqlDoc {
  const keyword = CONSTRAINT_KEYWORDS[node.contype ?? '']
  if (!keyword) throw new UnsupportedNodeError('Constraint', String(node.contype))
  const parts: SqlDoc[] = []
  if (node.conname) parts.push(text(`CONSTRAINT ${ctx.source.quotedIdentifierNear(node.location ?? 0, node.conname)} `))
  switch (node.contype) {
    case 'CONSTR_DEFAULT':
      parts.push(text('DEFAULT '), ctx.print(node.raw_expr as Node))
      break
    case 'CONSTR_CHECK':
      parts.push(text('CHECK ('), ctx.print(node.raw_expr as Node), text(')'))
      if (node.is_no_inherit) parts.push(text(' NO INHERIT'))
      break
    case 'CONSTR_PRIMARY':
    case 'CONSTR_UNIQUE': {
      parts.push(text(keyword))
      if (node.nulls_not_distinct) parts.push(text(' NULLS NOT DISTINCT'))
      if (node.keys?.length) parts.push(text('('), join(text(', '), node.keys.map(key => printKey(key, ctx, node.location ?? 0))), text(')'))
      if (node.including?.length) parts.push(text(' INCLUDE ('), join(text(', '), node.including.map(key => printKey(key, ctx, node.location ?? 0))), text(')'))
      break
    }
    case 'CONSTR_FOREIGN': {
      if (node.fk_attrs?.length) {
        parts.push(text('FOREIGN KEY ('), join(text(', '), node.fk_attrs.map(key => printKey(key, ctx, node.location ?? 0))), text(')'))
      }
      parts.push(text(node.fk_attrs?.length ? ' REFERENCES ' : 'REFERENCES '), ctx.print({ RangeVar: node.pktable } as Node))
      if (node.pk_attrs?.length) parts.push(text('('), join(text(', '), node.pk_attrs.map(key => printKey(key, ctx, node.pktable?.location ?? node.location ?? 0))), text(')'))
      if (node.fk_matchtype && node.fk_matchtype !== 's') parts.push(text(` MATCH ${fkMatch(node.fk_matchtype)}`))
      if (node.fk_del_action && node.fk_del_action !== 'a') parts.push(text(` ON DELETE ${fkAction(node.fk_del_action)}`))
      if (node.fk_upd_action && node.fk_upd_action !== 'a') parts.push(text(` ON UPDATE ${fkAction(node.fk_upd_action)}`))
      break
    }
    case 'CONSTR_IDENTITY':
    case 'CONSTR_GENERATED': {
      const when = node.generated_when === 'ALWAYS' ? 'ALWAYS' : 'BY DEFAULT'
      if (node.contype === 'CONSTR_IDENTITY') parts.push(text(`GENERATED ${when} AS IDENTITY`))
      else parts.push(text(`GENERATED ${when} AS (`), ctx.print(node.raw_expr as Node), text(') STORED'))
      break
    }
    case 'CONSTR_EXCLUSION':
      throw new UnsupportedNodeError('Constraint', 'EXCLUDE')
    default:
      parts.push(text(keyword))
      break
  }
  if (node.initially_valid === false) parts.push(text(' NOT VALID'))
  return concat(...parts)
}

/**
 * Print one key or identifier node.
 * @param node
 */
function printKey(node: Node, ctx: PrintContext, position: number): SqlDoc {
  if (kindOf(node) !== 'String') throw new UnsupportedNodeError('Constraint', 'non-name key')
  return text(ctx.source.quotedIdentifierNear(position, stringValue(node)))
}

/**
 * Map a foreign-key match type.
 * @param value
 */
function fkMatch(value: string): string {
  return value === 'f' ? 'FULL' : value === 'p' ? 'PARTIAL' : 'SIMPLE'
}

/**
 * Map a foreign-key action.
 * @param value
 */
function fkAction(value: string): string {
  const actions: Record<string, string> = {
    a: 'NO ACTION',
    c: 'CASCADE',
    d: 'SET DEFAULT',
    n: 'SET NULL',
    r: 'RESTRICT',
  }
  return actions[value] ?? 'NO ACTION'
}

/**
 * Print CREATE INDEX.
 * @param node
 * @param ctx
 */
export function printIndexStmt(node: ValueOf<'IndexStmt'>, ctx: PrintContext): SqlDoc {
  if (node.primary || node.isconstraint) throw new UnsupportedNodeError('IndexStmt', 'constraint index')
  const parts: SqlDoc[] = [
    text(`CREATE ${node.unique ? 'UNIQUE ' : ''}INDEX ${node.concurrent ? 'CONCURRENTLY ' : ''}${node.if_not_exists ? 'IF NOT EXISTS ' : ''}`),
    text(quoteIdentifier(node.idxname ?? '')),
    text(' ON '),
    ctx.print({ RangeVar: node.relation } as Node),
  ]
  const relationEnd = ctx.source.span(node.relation as Node)?.end ?? 0
  const explicitUsing = ctx.source.tokens.some(token => token.start >= relationEnd && token.text.toLowerCase() === 'using')
  if (node.accessMethod && explicitUsing) parts.push(text(` USING ${quoteIdentifier(node.accessMethod)}`))
  parts.push(text(' ('), list((node.indexParams ?? []).map(ctx.print), text(', ')), text(')'))
  if (node.indexIncludingParams?.length) {
    parts.push(text(' INCLUDE ('), list(node.indexIncludingParams.map(ctx.print), text(', ')), text(')'))
  }
  if (node.nulls_not_distinct) parts.push(text(' NULLS NOT DISTINCT'))
  if (node.options?.length) parts.push(text(' WITH ('), printDefElems(node.options, ctx), text(')'))
  if (node.tableSpace) parts.push(text(` TABLESPACE ${quoteIdentifier(node.tableSpace)}`))
  if (node.whereClause) parts.push(text(' WHERE '), ctx.print(node.whereClause))
  return concat(...parts)
}

/**
 * Print one index element.
 * @param node
 * @param ctx
 */
export function printIndexElem(node: ValueOf<'IndexElem'>, ctx: PrintContext): SqlDoc {
  const parts: SqlDoc[] = []
  if (node.name !== undefined) parts.push(printName(node.name))
  else if (node.expr) parts.push(ctx.print(node.expr))
  else throw new UnsupportedNodeError('IndexElem', 'missing column or expression')
  if (node.collation?.length) parts.push(text(' COLLATE '), text(stringValues(node.collation).map(quoteIdentifier).join('.')))
  if (node.opclass?.length) parts.push(text(' '), text(stringValues(node.opclass).map(quoteIdentifier).join('.')))
  if (node.ordering === 'SORTBY_ASC') parts.push(text(' ASC'))
  if (node.ordering === 'SORTBY_DESC') parts.push(text(' DESC'))
  if (node.nulls_ordering === 'SORTBY_NULLS_FIRST') parts.push(text(' NULLS FIRST'))
  if (node.nulls_ordering === 'SORTBY_NULLS_LAST') parts.push(text(' NULLS LAST'))
  return concat(...parts)
}

/**
 * Print CREATE VIEW.
 * @param node
 * @param ctx
 */
export function printViewStmt(node: ValueOf<'ViewStmt'>, ctx: PrintContext): SqlDoc {
  const view = node.view as ValueOf<'RangeVar'>
  const persistence = view.relpersistence === 't' ? 'TEMPORARY ' : ''
  const aliases = node.aliases?.length
    ? concat(text(' ('), join(text(', '), stringValues(node.aliases).map(name => text(quoteIdentifier(name)))), text(')'))
    : empty
  const parts: SqlDoc[] = [
    text(`CREATE ${node.replace ? 'OR REPLACE ' : ''}${persistence}VIEW `),
    printRangeVar(view, ctx),
    aliases,
  ]
  if (node.options?.length) parts.push(text(' WITH ('), printDefElems(node.options, ctx), text(')'))
  parts.push(
    text(' AS ('),
    indent(concat(hardline(), ctx.print(node.query as Node))),
    hardline(),
    text(')'),
  )
  if (node.withCheckOption === 'CASCADED_CHECK_OPTION') parts.push(text(' WITH CASCADED CHECK OPTION'))
  if (node.withCheckOption === 'LOCAL_CHECK_OPTION') parts.push(text(' WITH LOCAL CHECK OPTION'))
  return concat(...parts)
}

/**
 * Print CREATE SEQUENCE.
 * @param node
 * @param ctx
 */
export function printCreateSeqStmt(node: ValueOf<'CreateSeqStmt'>, ctx: PrintContext): SqlDoc {
  const sequence = node.sequence as ValueOf<'RangeVar'>
  const persistence = sequence.relpersistence === 't' ? 'TEMPORARY ' : ''
  const parts: SqlDoc[] = [
    text(`CREATE ${persistence}SEQUENCE ${node.if_not_exists ? 'IF NOT EXISTS ' : ''}`),
    printRangeVar(sequence, ctx),
  ]
  for (const option of node.options ?? []) parts.push(text(' '), printDefElemOption(option, ctx))
  return concat(...parts)
}

/**
 * Print CREATE TRIGGER.
 * @param node
 * @param ctx
 */
export function printCreateTrigStmt(node: ValueOf<'CreateTrigStmt'>, ctx: PrintContext): SqlDoc {
  const flags = node.timing ?? 0
  let timing = 'AFTER'
  if (flags & 64) timing = 'INSTEAD OF'
  else if (flags & 2) timing = 'BEFORE'
  const events: string[] = []
  if ((node.events ?? 0) & 4) events.push('INSERT')
  if ((node.events ?? 0) & 8) events.push('DELETE')
  if ((node.events ?? 0) & 16) events.push('UPDATE')
  if ((node.events ?? 0) & 32) events.push('TRUNCATE')
  if (events.length === 0) throw new UnsupportedNodeError('CreateTrigStmt', 'missing events')
  const parts: SqlDoc[] = [
    text(`CREATE ${node.replace ? 'OR REPLACE ' : ''}${node.isconstraint ? 'CONSTRAINT ' : ''}TRIGGER `),
    text(quoteIdentifier(node.trigname ?? '')),
    line(),
    text(`${timing} ${events.join(' OR ')} ON `),
    ctx.print({ RangeVar: node.relation } as Node),
  ]
  if (node.constrrel) parts.push(text(' FROM '), ctx.print({ RangeVar: node.constrrel } as Node))
  if (node.deferrable) parts.push(text(' DEFERRABLE'))
  if (node.initdeferred) parts.push(text(' INITIALLY DEFERRED'))
  parts.push(line(), text(node.row ? 'FOR EACH ROW' : 'FOR EACH STATEMENT'))
  if (node.whenClause) parts.push(text(' WHEN ('), ctx.print(node.whenClause as Node), text(')'))
  parts.push(
    line(),
    text(`EXECUTE FUNCTION ${functionName(stringValues(node.funcname))}(`),
    join(text(', '), (node.args ?? []).map(argument => {
      if (kindOf(argument) === 'String') return text(`'${stringValue(argument).replace(/'/gu, "''")}'`)
      return ctx.print(argument)
    })),
    text(')'),
  )
  return group(concat(...parts))
}

/**
 * Print ALTER TABLE.
 * @param node
 * @param ctx
 */
export function printAlterTableStmt(node: ValueOf<'AlterTableStmt'>, ctx: PrintContext): SqlDoc {
  if (node.objtype !== 'OBJECT_TABLE') throw new UnsupportedNodeError('AlterTableStmt', String(node.objtype))
  const parts: SqlDoc[] = [text(`ALTER TABLE ${node.missing_ok ? 'IF EXISTS ' : ''}`), ctx.print({ RangeVar: node.relation } as Node)]
  const commands = (node.cmds ?? []).map(command => printAlterTableCmd(bodyOf<ValueOf<'AlterTableCmd'>>(command), ctx))
  parts.push(text(' '), join(text(', '), commands))
  return concat(...parts)
}

/**
 * Print one ALTER TABLE command.
 * @param node
 * @param ctx
 */
function printAlterTableCmd(node: ValueOf<'AlterTableCmd'>, ctx: PrintContext): SqlDoc {
  const behavior = node.behavior === 'DROP_CASCADE' ? ' CASCADE' : ''
  switch (node.subtype) {
    case 'AT_EnableRowSecurity': return text('ENABLE ROW LEVEL SECURITY')
    case 'AT_DisableRowSecurity': return text('DISABLE ROW LEVEL SECURITY')
    case 'AT_ForceRowSecurity': return text('FORCE ROW LEVEL SECURITY')
    case 'AT_NoForceRowSecurity': return text('NO FORCE ROW LEVEL SECURITY')
    case 'AT_AddColumn': return concat(text('ADD COLUMN '), ctx.print(node.def as Node))
    case 'AT_DropColumn': return concat(text(`DROP COLUMN ${node.missing_ok ? 'IF EXISTS ' : ''}${quoteIdentifier(node.name ?? '')}${behavior}`))
    case 'AT_SetNotNull': return concat(text(`ALTER COLUMN ${quoteIdentifier(node.name ?? '')} SET NOT NULL`))
    case 'AT_DropNotNull': return concat(text(`ALTER COLUMN ${quoteIdentifier(node.name ?? '')} DROP NOT NULL`))
    case 'AT_AddConstraint': return concat(text('ADD '), ctx.print(node.def as Node))
    case 'AT_DropConstraint': return concat(text(`DROP CONSTRAINT ${node.missing_ok ? 'IF EXISTS ' : ''}${quoteIdentifier(node.name ?? '')}${behavior}`))
    case 'AT_ColumnDefault': return concat(text(`ALTER COLUMN ${quoteIdentifier(node.name ?? '')} SET DEFAULT `), ctx.print(node.def as Node))
    default: throw new UnsupportedNodeError('AlterTableCmd', String(node.subtype))
  }
}

/**
 * Print DROP.
 * @param node
 */
export function printDropStmt(node: ValueOf<'DropStmt'>): SqlDoc {
  const objectType = DROP_TYPES[node.removeType ?? '']
  if (!objectType) throw new UnsupportedNodeError('DropStmt', String(node.removeType))
  const objects = (node.objects ?? []).map(object => {
    const parts = bodyOf<{ items?: Node[] }>(object).items ?? []
    return parts.map(part => {
      if (kindOf(part) !== 'String') throw new UnsupportedNodeError('DropStmt', 'non-name object')
      return quoteIdentifier(stringValue(part))
    }).join('.')
  })
  return concat(
    text(`DROP ${objectType} ${node.concurrent ? 'CONCURRENTLY ' : ''}${node.missing_ok ? 'IF EXISTS ' : ''}`),
    text(objects.join(', ')),
    text(node.behavior === 'DROP_CASCADE' ? ' CASCADE' : ''),
  )
}

/** Drop statement object keywords. */
const DROP_TYPES: Record<string, string> = {
  OBJECT_INDEX: 'INDEX',
  OBJECT_SCHEMA: 'SCHEMA',
  OBJECT_SEQUENCE: 'SEQUENCE',
  OBJECT_TABLE: 'TABLE',
  OBJECT_TRIGGER: 'TRIGGER',
  OBJECT_TYPE: 'TYPE',
  OBJECT_VIEW: 'VIEW',
}

/**
 * Print VACUUM/ANALYZE.
 * @param node
 * @param ctx
 */
export function printVacuumStmt(node: ValueOf<'VacuumStmt'>, ctx: PrintContext): SqlDoc {
  const command = node.is_vacuumcmd === true ? 'VACUUM' : 'ANALYZE'
  const parts: SqlDoc[] = [text(command)]
  for (const option of node.options ?? []) parts.push(text(' '), printDefElemOption(option, ctx))
  if (node.rels?.length) {
    parts.push(text(' '), join(text(', '), node.rels.map(relation => printVacuumRelation(bodyOf<ValueOf<'VacuumRelation'>>(relation), ctx))))
  }
  return concat(...parts)
}

/**
 * Print one VACUUM relation.
 * @param node
 * @param ctx
 */
function printVacuumRelation(node: ValueOf<'VacuumRelation'>, ctx: PrintContext): SqlDoc {
  const relation = ctx.print({ RangeVar: node.relation } as Node)
  if (!node.va_cols?.length) return relation
  return concat(relation, text(' ('), join(text(', '), node.va_cols.map(column => {
    if (kindOf(column) !== 'String') throw new UnsupportedNodeError('VacuumRelation', 'non-name column')
    return text(quoteIdentifier(stringValue(column)))
  })), text(')'))
}

/**
 * Print SET CONSTRAINTS.
 * @param node
 */
export function printConstraintsSetStmt(node: ValueOf<'ConstraintsSetStmt'>): SqlDoc {
  let targets = 'ALL'
  if (node.constraints?.length) {
    targets = node.constraints.map(constraint => {
      const items = bodyOf<{ items?: Node[] }>(constraint).items ?? []
      return items.map(item => quoteIdentifier(stringValue(item))).join('.')
    }).join(', ')
  }
  return text(`SET CONSTRAINTS ${targets} ${node.deferred ? 'DEFERRED' : 'IMMEDIATE'}`)
}

/**
 * Print SET/RESET.
 * @param node
 * @param ctx
 */
export function printVariableSetStmt(node: ValueOf<'VariableSetStmt'>, ctx: PrintContext): SqlDoc {
  const prefix = node.is_local ? 'SET LOCAL ' : 'SET '
  switch (node.kind) {
    case 'VAR_RESET':
      return text(`RESET ${quoteIdentifier(node.name ?? '')}`)
    case 'VAR_RESET_ALL':
      return text('RESET ALL')
    case 'VAR_SET_DEFAULT':
      return text(`${prefix}${quoteIdentifier(node.name ?? '')} TO DEFAULT`)
    case 'VAR_SET_CURRENT':
      return text(`${prefix}${quoteIdentifier(node.name ?? '')} FROM CURRENT`)
    case 'VAR_SET_VALUE':
    case 'VAR_SET_MULTI': {
      const name = node.name === 'TRANSACTION'
        ? empty
        : concat(text(quoteIdentifier(node.name ?? '')), text(' = '))
      return concat(text(prefix), name, join(text(', '), (node.args ?? []).map(ctx.print)))
    }
    default:
      throw new UnsupportedNodeError('VariableSetStmt', String(node.kind))
  }
}

/**
 * Print BEGIN/COMMIT/ROLLBACK and related transaction statements.
 * @param node
 */
export function printTransactionStmt(node: ValueOf<'TransactionStmt'>): SqlDoc {
  const kinds: Record<string, string> = {
    TRANS_STMT_BEGIN: 'BEGIN',
    TRANS_STMT_COMMIT: 'COMMIT',
    TRANS_STMT_COMMIT_PREPARED: 'COMMIT PREPARED',
    TRANS_STMT_PREPARE: 'PREPARE TRANSACTION',
    TRANS_STMT_RELEASE: 'RELEASE SAVEPOINT',
    TRANS_STMT_ROLLBACK: 'ROLLBACK',
    TRANS_STMT_ROLLBACK_PREPARED: 'ROLLBACK PREPARED',
    TRANS_STMT_ROLLBACK_TO: 'ROLLBACK TO SAVEPOINT',
    TRANS_STMT_SAVEPOINT: 'SAVEPOINT',
    TRANS_STMT_START: 'START TRANSACTION',
  }
  const keyword = kinds[node.kind ?? '']
  if (!keyword) throw new UnsupportedNodeError('TransactionStmt', String(node.kind))
  const name = node.savepoint_name ?? node.gid
  return text(name ? `${keyword} ${quoteIdentifier(name)}` : keyword)
}

/**
 * Print CREATE SCHEMA.
 * @param node
 */
export function printCreateSchemaStmt(node: ValueOf<'CreateSchemaStmt'>): SqlDoc {
  if (node.schemaElts?.length) throw new UnsupportedNodeError('CreateSchemaStmt', 'schema elements')
  const parts: SqlDoc[] = [text(`CREATE SCHEMA ${node.if_not_exists ? 'IF NOT EXISTS ' : ''}${quoteIdentifier(node.schemaname ?? '')}`)]
  if (node.authrole) parts.push(text(' AUTHORIZATION '), text(quoteIdentifier(node.authrole.rolename ?? '')))
  return concat(...parts)
}

/**
 * Print a DefElem list (`WITH (...)`).
 * @param options
 * @param ctx
 */
function printDefElems(options: readonly Node[], ctx: PrintContext): SqlDoc {
  return join(text(', '), options.map(option => printDefElem(bodyOf<ValueOf<'DefElem'>>(option), ctx)))
}

/**
 * Print one DefElem as a `WITH` option.
 * @param node
 * @param ctx
 */
export function printDefElem(node: ValueOf<'DefElem'>, ctx: PrintContext): SqlDoc {
  if (node.defaction === 'DEFELEM_SET') {
    return concat(text(quoteIdentifier(node.defname ?? '')), node.arg ? concat(text(' = '), ctx.print(node.arg)) : empty)
  }
  if (node.arg === undefined) return text(quoteIdentifier(node.defname ?? ''))
  return concat(text(quoteIdentifier(node.defname ?? '')), text(' '), ctx.print(node.arg))
}

/**
 * Print one DefElem in statement-option position (SEQUENCE/VACUUM).
 * @param node
 * @param ctx
 */
export function printDefElemOption(node: Node, ctx: PrintContext): SqlDoc {
  const option = bodyOf<ValueOf<'DefElem'>>(node)
  const name = (option.defname ?? '').toUpperCase()
  if (option.defname === 'cycle') {
    return text(booleanValue(option.arg as Node) ? 'CYCLE' : 'NO CYCLE')
  }
  if (option.defname === 'owned_by') {
    const items = (option.arg ? bodyOf<{ items?: Node[] }>(option.arg).items : undefined) ?? []
    return text(`OWNED BY ${items.map(item => quoteIdentifier(stringValue(item))).join('.')}`)
  }
  if (option.arg === undefined) return text(name)
  if (kindOf(option.arg) === 'String' && option.defname === 'as') {
    return text(`AS ${quoteIdentifier(stringValue(option.arg))}`)
  }
  return concat(text(name), text(' '), ctx.print(option.arg))
}

/** Map folded output alias names to their canonical quoted spelling. */
function outputAliases(targets: readonly Node[] | undefined, ctx: PrintContext): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const target of targets ?? []) {
    const value = bodyOf<ValueOf<'ResTarget'>>(target)
    if (value.name === undefined) continue
    const alias = ctx.source.aliasAfter(ctx.source.span(value.val as Node)?.start ?? 0)
    aliases.set(value.name.toLowerCase(), alias === undefined ? quoteIdentifier(value.name) : quotePart(alias, ctx))
  }
  return aliases
}

/**
 * Print one-item-per-line list with comments attached to their source items.
 * @param items
 * @param ctx
 * @param startBoundary
 * @param endBoundary
 */
function printCommaList(items: readonly Node[], ctx: PrintContext, startBoundary: number, endBoundary: number): SqlDoc {
  const children: SqlDoc[] = []
  let previousEnd = startBoundary
  items.forEach((item, index) => {
    const span = ctx.source.span(item)
    const start = span?.start ?? previousEnd
    const leading = ctx.source.takeComments(previousEnd, start)
    for (const comment of leading) children.push(text(comment.text), hardline())
    children.push(ctx.print(item))
    if (index < items.length - 1) children.push(text(','))
    const next = items[index + 1]
    const nextStart = next ? ctx.source.span(next)?.start ?? endBoundary : endBoundary
    const comments = span ? ctx.source.takeComments(span.end, nextStart) : []
    if (comments.length > 0) {
      const first = comments[0] as { line: number, text: string }
      const inline = span !== null && first.line === ctx.source.lineAt(span.end)
      if (inline) {
        children.push(text(` ${first.text}`))
        if (comments.length > 1) {
          children.push(hardline(), join(hardline(), comments.slice(1).map(comment => text(comment.text))))
        }
      } else {
        children.push(hardline(), join(hardline(), comments.map(comment => text(comment.text))))
      }
    }
    if (index < items.length - 1) children.push(hardline())
    previousEnd = span?.end ?? previousEnd
  })
  return concat(...children)
}

/**
 * Print a SELECT target list with comments attached to their source items.
 * @param targets
 * @param boundary
 * @param ctx
 */
function printTargetList(targets: readonly Node[], boundary: number, ctx: PrintContext): SqlDoc {
  const children: SqlDoc[] = []
  targets.forEach((target, index) => {
    const doc = ctx.print(target)
    const span = ctx.source.span(target)
    const next = targets[index + 1]
    const nextStart = next ? ctx.source.span(next)?.start : boundary
    const comments = span && nextStart !== undefined
      ? nextStart === Number.POSITIVE_INFINITY
        ? ctx.source.takeInlineComments(ctx.source.lineAt(span.end), span.end, ctx.source.sql.length)
        : ctx.source.takeComments(span.end, nextStart)
      : []
    children.push(doc)
    if (index < targets.length - 1) children.push(text(','))
    if (comments.length > 0) {
      const first = comments[0]
      const inline = span !== null && first !== undefined && first.line === ctx.source.lineAt(span.end)
      if (inline) {
        children.push(text(` ${(first as { text: string }).text}`))
        if (comments.length > 1) {
          children.push(hardline(), join(hardline(), comments.slice(1).map(comment => text(comment.text))))
        }
      } else {
        children.push(hardline(), join(hardline(), comments.map(comment => text(comment.text))))
      }
      if (index < targets.length - 1) children.push(hardline())
    } else if (index < targets.length - 1) {
      children.push(line())
    }
  })
  return concat(...children)
}

/**
 * Push a clause, including any comments between the previous clause and it.
 * @param parts
 * @param keyword
 * @param node
 * @param previousEnd
 * @param ctx
 * @param content
 */
function pushClause(
  parts: SqlDoc[],
  keyword: string,
  node: Node | undefined,
  previousEnd: number,
  ctx: PrintContext,
  content: () => SqlDoc,
): void {
  const start = node ? ctx.source.span(node)?.start : undefined
  if (start !== undefined && start >= previousEnd) {
    const comments = ctx.source.takeComments(previousEnd, start)
    if (comments.length > 0) {
      parts.push(hardline(), join(hardline(), comments.map(comment => text(comment.text))), hardline())
    } else {
      parts.push(hardline())
    }
  } else {
    parts.push(hardline())
  }
  parts.push(text(keyword), content())
}

/**
 * Start position of the first node in the first non-empty clause.
 * @param clauses
 * @param ctx
 */
function firstClauseStart(clauses: readonly (readonly Node[] | undefined)[], ctx: PrintContext): number | undefined {
  for (const nodes of clauses) {
    const first = nodes?.[0]
    if (first) {
      const start = ctx.source.span(first)?.start
      if (start !== undefined) return start
    }
  }
  return undefined
}

/**
 * First node of a clause.
 * @param nodes
 */
function firstNode(nodes: readonly Node[] | undefined): Node | undefined {
  return nodes?.[0]
}

/**
 * End position of the last node in a clause.
 * @param nodes
 * @param source
 */
function lastNodeEnd(nodes: readonly Node[] | undefined, source: SourceText): number {
  const last = nodes?.[nodes.length - 1]
  return last ? source.span(last)?.end ?? 0 : 0
}
