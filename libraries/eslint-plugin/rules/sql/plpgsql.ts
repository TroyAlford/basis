/* eslint-disable @stylistic/max-len -- SQL fixtures and protocol field names need long lines. */
/* eslint-disable camelcase */
import type { Node } from 'libpg-query'
import { parseSync } from 'libpg-query'
import type { SqlDoc } from './doc'
import { concat, group, hardline, indent, join, line, text } from './doc'
import type { ValueOf } from './expressions'
import { empty, functionName, printResTarget, printTypeName, quoteIdentifier, quotePart } from './expressions'
import type { PrintContext } from './printer'
import { SourceText } from './source'
import { printSelect } from './statements'
import { bodyOf, booleanValue, kindOf, stringValue, UnsupportedNodeError } from './types'

/** A PL/pgSQL expression wrapper. */
export interface PlExpr {
  parseMode?: number,
  query?: string,
}

/** A PL/pgSQL datum entry. */
export type PlDatum = Record<string, unknown>

/** A PL/pgSQL function tree. */
export type PlFunction = {
  action?: unknown,
  datums?: PlDatum[],
  old_varno?: number,
} & Record<string, unknown>

/** One PL/pgSQL statement as a protocol-tagged object. */
export type PlStmt = Record<string, unknown>

/** A PL/pgSQL block body. */
interface PlBlock {
  body?: PlStmt[],
  exceptions?: unknown,
  lineno?: number,
}

/** Comments and source state for one PL/pgSQL body. */
interface PlState {
  comments: readonly { line: number, text: string }[],
  datums: readonly PlDatum[],
  used: Set<number>,
}

/** Comments that are PL/pgSQL runtime variables, not user declarations. */
const IMPLICIT_VARIABLES = new Set(['sqlstate', 'sqlerrm'])

/**
 * Print a CREATE FUNCTION statement, including its PL/pgSQL body.
 * @param node
 * @param ctx
 */
export function printCreateFunctionStmt(node: ValueOf<'CreateFunctionStmt'>, ctx: PrintContext): SqlDoc {
  if (node.sql_body) throw new UnsupportedNodeError('CreateFunctionStmt', 'SQL body')
  const body = functionBody(node.options ?? [])
  if (body === null) throw new UnsupportedNodeError('CreateFunctionStmt', 'missing AS body')
  const language = functionLanguage(node.options ?? [])
  if (language !== 'plpgsql') {
    throw new UnsupportedNodeError('CreateFunctionStmt', `language ${language ?? 'unknown'}`)
  }
  const fn = ctx.takePlFunction()
  if (!fn) throw new UnsupportedNodeError('CreateFunctionStmt', 'missing PL/pgSQL parse')

  const parameters = node.parameters ?? []
  const tableParameters = parameters.filter(parameter => bodyOf<{ mode?: string }>(parameter).mode === 'FUNC_PARAM_TABLE')
  const normalParameters = parameters.filter(parameter => bodyOf<{ mode?: string }>(parameter).mode !== 'FUNC_PARAM_TABLE')
  const header: SqlDoc[] = [
    text(`CREATE ${node.replace ? 'OR REPLACE ' : ''}${node.is_procedure ? 'PROCEDURE' : 'FUNCTION'} `),
    text(functionName((node.funcname ?? []).map(name => stringValue(name)))),
    text('('),
    join(text(', '), normalParameters.map(parameter => printFunctionParameter(bodyOf<ValueOf<'FunctionParameter'>>(parameter), ctx))),
    text(')'),
  ]
  if (!node.is_procedure) {
    if (tableParameters.length) {
      header.push(
        text(' RETURNS TABLE ('),
        join(text(', '), tableParameters.map(parameter => printFunctionParameter(bodyOf<ValueOf<'FunctionParameter'>>(parameter), ctx))),
        text(')'),
      )
    } else if (node.returnType) {
      header.push(text(' RETURNS '), printTypeName(node.returnType, ctx))
    }
  }

  const tag = dollarTag(body)
  const bodyDoc = printPlBody(fn, body, ctx)
  const attributes = printFunctionAttributes(node.options ?? [], ctx)
  return concat(
    ...header,
    text(` AS ${tag}`),
    hardline(),
    bodyDoc,
    hardline(),
    text(tag),
    attributes,
  )
}

/**
 * Print a DO statement.
 * @param node
 * @param ctx
 */
export function printDoStmt(node: ValueOf<'DoStmt'>, ctx: PrintContext): SqlDoc {
  const body = functionBody(node.args ?? [])
  if (body === null) throw new UnsupportedNodeError('DoStmt', 'missing AS body')
  const language = functionLanguage(node.args ?? [])
  if (language !== undefined && language !== 'plpgsql') {
    throw new UnsupportedNodeError('DoStmt', `language ${language}`)
  }
  const fn = ctx.takePlFunction()
  if (!fn) throw new UnsupportedNodeError('DoStmt', 'missing PL/pgSQL parse')
  const tag = dollarTag(body)
  const languageOption = language === undefined
    ? empty
    : text(` LANGUAGE ${language}`)
  return concat(
    text(`DO ${tag}`),
    hardline(),
    printPlBody(fn, body, ctx),
    hardline(),
    text(tag),
    languageOption,
  )
}

/**
 * Read the function body from an `AS` option.
 * @param options
 */
function functionBody(options: readonly Node[]): string | null {
  for (const option of options) {
    const value = bodyOf<ValueOf<'DefElem'>>(option)
    if (value.defname !== 'as' || !value.arg) continue
    if (kindOf(value.arg) === 'String') return stringValue(value.arg)
    const items = bodyOf<{ items?: Node[] }>(value.arg).items ?? []
    const first = items[0]
    if (first === undefined) return null
    return stringValue(first)
  }
  return null
}

/**
 * Read the function language.
 * @param options
 */
function functionLanguage(options: readonly Node[]): string | undefined {
  for (const option of options) {
    const value = bodyOf<ValueOf<'DefElem'>>(option)
    if (value.defname === 'language' && value.arg) return stringValue(value.arg)
  }
  return undefined
}

/**
 * Print supported function attributes after the body.
 * @param options
 * @param ctx
 */
function printFunctionAttributes(options: readonly Node[], ctx: PrintContext): SqlDoc {
  const parts: SqlDoc[] = []
  for (const option of options) {
    const value = bodyOf<ValueOf<'DefElem'>>(option)
    const name = value.defname ?? ''
    if (name === 'as') continue
    switch (name) {
      case 'language':
        if (value.arg) parts.push(text(` LANGUAGE ${stringValue(value.arg)}`))
        break
      case 'volatility':
        parts.push(text(` ${(stringValue(value.arg as Node) || 'VOLATILE').toUpperCase()}`))
        break
      case 'strict':
        parts.push(text(' STRICT'))
        break
      case 'security':
        parts.push(text(` SECURITY ${(stringValue(value.arg as Node) || 'INVOKER').toUpperCase()}`))
        break
      case 'leakproof':
        parts.push(text(value.arg && kindOf(value.arg) === 'Boolean' && booleanValue(value.arg) ? ' LEAKPROOF' : ' NOT LEAKPROOF'))
        break
      case 'parallel':
        parts.push(text(` PARALLEL ${(stringValue(value.arg as Node) || 'UNSAFE').toUpperCase()}`))
        break
      case 'cost':
        parts.push(text(' COST '), ctx.print(value.arg as Node))
        break
      case 'rows':
        parts.push(text(' ROWS '), ctx.print(value.arg as Node))
        break
      case 'window':
        parts.push(text(' WINDOW'))
        break
      case 'set':
        parts.push(text(' SET '), printSetOption(value.arg, ctx))
        break
      default:
        throw new UnsupportedNodeError('CreateFunctionStmt', `option ${name}`)
    }
  }
  return concat(...parts)
}

/**
 * Print a function parameter.
 * @param node
 * @param ctx
 */
function printFunctionParameter(node: ValueOf<'FunctionParameter'>, ctx: PrintContext): SqlDoc {
  const mode = node.mode === 'FUNC_PARAM_OUT' ? 'OUT '
    : node.mode === 'FUNC_PARAM_INOUT' ? 'INOUT '
      : node.mode === 'FUNC_PARAM_VARIADIC' ? 'VARIADIC '
        : node.mode === 'FUNC_PARAM_TABLE' ? 'TABLE '
          : ''
  const name = node.name === undefined
    ? empty
    : concat(text(`${quotePart(ctx.source.identifierAt(node.location, node.name), ctx)} `))
  const defaultValue = node.defexpr ? concat(text(' DEFAULT '), ctx.print(node.defexpr as Node)) : empty
  return concat(text(mode), name, printTypeName(node.argType as ValueOf<'TypeName'>, ctx), defaultValue)
}

/**
 * Print one `SET` function attribute.
 * @param value
 * @param ctx
 */
function printSetOption(value: unknown, ctx: PrintContext): SqlDoc {
  if (!value) throw new UnsupportedNodeError('CreateFunctionStmt', 'SET option')
  const kind = kindOf(value)
  if (kind === 'VariableSetStmt') {
    const set = bodyOf<ValueOf<'VariableSetStmt'>>(value)
    const args = (set.args ?? []).map(argument => ctx.print(argument))
    return concat(text(quoteIdentifier(set.name ?? '')), text(' = '), join(text(', '), args))
  }
  if (kind === 'List') {
    const items = bodyOf<{ items?: Node[] }>(value).items ?? []
    if (items.length < 2) throw new UnsupportedNodeError('CreateFunctionStmt', 'SET option')
    return concat(text(quoteIdentifier(stringValue(items[0] as Node))), text(' = '), join(text(', '), items.slice(1).map(item => ctx.print(item))))
  }
  throw new UnsupportedNodeError('CreateFunctionStmt', 'SET option')
}

/**
 * Print a PL/pgSQL function body.
 * @param fn
 * @param bodyText
 * @param ctx
 */
function printPlBody(fn: PlFunction, bodyText: string, ctx: PrintContext): SqlDoc {
  const bodySource = new SourceText(bodyText)
  const state: PlState = { comments: bodySource.comments, datums: fn.datums ?? [], used: new Set() }
  const outer = bodyOf<PlBlock>(fn.action)
  const inner = (outer.body ?? []).find(statement => kindOf(statement) === 'PLpgSQL_stmt_block')
  const main = inner ? bodyOf<PlBlock>(inner) : outer
  const declarations = printDeclarations(fn, ctx)
  const parts: SqlDoc[] = []
  if (declarations.length > 0) {
    parts.push(text('DECLARE'), indent(concat(hardline(), join(hardline(), declarations))), hardline())
  }
  parts.push(printPlBlock(main, ctx, state, true))
  return concat(...parts)
}

/**
 * Print user declarations.
 * @param fn
 * @param ctx
 */
function printDeclarations(fn: PlFunction, ctx: PrintContext): SqlDoc[] {
  const loopVariables = collectLoopVariables(fn.action)
  const declarations: SqlDoc[] = []
  for (const datum of fn.datums ?? []) {
    const kind = kindOf(datum)
    const value = bodyOf<Record<string, unknown>>(datum)
    if (kind === 'PLpgSQL_var') {
      const variable = value as unknown as {
        datatype?: unknown,
        default_val?: { PLpgSQL_expr?: PlExpr },
        isconst?: boolean,
        lineno?: number,
        notnull?: boolean,
        refname?: string,
      }
      const name = variable.refname ?? ''
      if (!variable.lineno || variable.lineno <= 0) continue
      if (IMPLICIT_VARIABLES.has(name) || loopVariables.has(name) || /^__case__variable_\d+__$/iu.test(name)) continue
      const constant = variable.isconst ? ' CONSTANT' : ''
      const notnull = variable.notnull ? ' NOT NULL' : ''
      const defaultValue = variable.default_val?.PLpgSQL_expr?.query
        ? concat(text(' DEFAULT '), expressionDoc(variable.default_val.PLpgSQL_expr.query, ctx))
        : empty
      declarations.push(concat(
        text(quoteIdentifier(name)),
        text(constant),
        text(' '),
        plType(variable.datatype),
        text(notnull),
        defaultValue,
        text(';'),
      ))
    } else if (kind === 'PLpgSQL_rec') {
      const record = value as unknown as { lineno?: number, refname?: string }
      if (!record.lineno || record.lineno <= 0) continue
      if (!record.refname || record.refname === '(unnamed row)') continue
      declarations.push(text(`${quoteIdentifier(record.refname)} RECORD;`))
    }
  }
  return declarations
}

/**
 * Collect variables introduced by FOR loops so they are not redeclared.
 * @param action
 */
function collectLoopVariables(action: unknown): Set<string> {
  const names = new Set<string>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    const kind = kindOf(value)
    if (kind === 'PLpgSQL_stmt_fori' || kind === 'PLpgSQL_stmt_fors' || kind === 'PLpgSQL_stmt_foreach_a') {
      const statement = bodyOf<Record<string, unknown>>(value)
      const variable = statement.var
      if (variable && typeof variable === 'object') {
        const datum = bodyOf<Record<string, unknown>>(variable)
        const name = (datum.refname as string | undefined) ?? ''
        if (name) names.add(name)
      }
    }
    for (const child of Object.values(value)) visit(child)
  }
  visit(action)
  return names
}

/**
 * Print one PL/pgSQL block.
 * @param block
 * @param ctx
 * @param state
 * @param top
 */
function printPlBlock(block: PlBlock, ctx: PrintContext, state: PlState, top = false): SqlDoc {
  const statements = block.body ?? []
  const parts: SqlDoc[] = [text('BEGIN')]
  const bodyParts: SqlDoc[] = []
  let previous: string | null = null
  for (const statement of statements) {
    if (isImplicitReturn(statement)) continue
    const kind = kindOf(statement) ?? ''
    const statementLine = (bodyOf<{ lineno?: number }>(statement).lineno ?? 0)
    const comments = takeCommentsBefore(state, statementLine)
    if (bodyParts.length > 0) {
      bodyParts.push(hardline())
      if (isControlStatement(previous)) bodyParts.push(hardline())
    }
    for (const comment of comments) bodyParts.push(text(comment), hardline())
    bodyParts.push(printPlStmt(statement, ctx, state))
    previous = kind
  }
  const remaining = takeCommentsBefore(state, Number.POSITIVE_INFINITY)
  if (remaining.length > 0) {
    if (bodyParts.length > 0) bodyParts.push(hardline())
    bodyParts.push(join(hardline(), remaining.map(comment => text(comment))))
  }
  if (bodyParts.length > 0) parts.push(indent(concat(hardline(), concat(...bodyParts))))
  const exception = printExceptions(block.exceptions, ctx, state)
  if (exception !== null) parts.push(hardline(), exception)
  parts.push(hardline(), text(top ? 'END' : 'END;'))
  return concat(...parts)
}

/**
 * Whether a return node is the parser's implicit final return.
 * @param statement
 */
function isImplicitReturn(statement: PlStmt): boolean {
  if (kindOf(statement) !== 'PLpgSQL_stmt_return') return false
  const value = bodyOf<{ expr?: unknown, lineno?: number, retvarno?: number }>(statement)
  return value.expr === undefined && value.retvarno === undefined && value.lineno === undefined
}

/**
 * Whether a statement kind should be followed by a blank line.
 * @param kind
 */
function isControlStatement(kind: string | null): boolean {
  return kind === 'PLpgSQL_stmt_if' || kind === 'PLpgSQL_stmt_case' || kind === 'PLpgSQL_stmt_loop'
    || kind === 'PLpgSQL_stmt_while' || kind === 'PLpgSQL_stmt_fori' || kind === 'PLpgSQL_stmt_fors'
    || kind === 'PLpgSQL_stmt_foreach_a'
}

/**
 * Take comments before a statement line.
 * @param state
 * @param maximumLine
 */
function takeCommentsBefore(state: PlState, maximumLine: number): string[] {
  const comments: string[] = []
  state.comments.forEach((comment, index) => {
    if (state.used.has(index)) return
    if (comment.line >= maximumLine) return
    state.used.add(index)
    comments.push(comment.text)
  })
  return comments
}

/**
 * Print the EXCEPTION section.
 * @param value
 * @param ctx
 * @param state
 */
function printExceptions(value: unknown, ctx: PrintContext, state: PlState): SqlDoc | null {
  if (!value) return null
  const block = bodyOf<{ exc_list?: unknown[] }>(value)
  const clauses = (block.exc_list ?? []).map(entry => {
    const exception = bodyOf<{ action?: PlStmt[], conditions?: unknown[] }>(entry)
    const conditions = (exception.conditions ?? []).map(condition => {
      const conditionValue = bodyOf<{ condname?: string, sqlstate?: string }>(condition)
      return conditionValue.condname ?? conditionValue.sqlstate ?? 'others'
    })
    const body = (exception.action ?? []).map(statement => printPlStmt(statement, ctx, state))
    return concat(
      text(`WHEN ${conditions.join(' OR ')} THEN`),
      body.length ? indent(concat(hardline(), join(hardline(), body))) : empty,
    )
  })
  return concat(text('EXCEPTION'), indent(concat(hardline(), join(hardline(), clauses))))
}

/**
 * Print one PL/pgSQL statement.
 * @param statement
 * @param ctx
 * @param state
 */
function printPlStmt(statement: PlStmt, ctx: PrintContext, state: PlState): SqlDoc {
  const kind = kindOf(statement)
  const value = bodyOf<Record<string, unknown>>(statement)
  switch (kind) {
    case 'PLpgSQL_stmt_block':
      return printPlBlock(value as unknown as PlBlock, ctx, state, false)
    case 'PLpgSQL_stmt_if':
      return printIf(value, ctx, state)
    case 'PLpgSQL_stmt_assign':
      return printAssign(value, ctx)
    case 'PLpgSQL_stmt_return':
      return printReturn(value, ctx, state)
    case 'PLpgSQL_stmt_raise':
      return printRaise(value, ctx)
    case 'PLpgSQL_stmt_execsql':
      return printExecSql(value, ctx)
    case 'PLpgSQL_stmt_perform':
      return printPerform(value, ctx)
    case 'PLpgSQL_stmt_dynexecute':
      return printDynamicExecute(value, ctx)
    case 'PLpgSQL_stmt_loop':
      return printLoop(value, ctx, state, 'LOOP', empty)
    case 'PLpgSQL_stmt_while':
      return printLoop(value, ctx, state, 'WHILE', concat(expressionDoc(exprQuery(value.cond), ctx), text(' LOOP')))
    case 'PLpgSQL_stmt_fori':
      return printForInteger(value, ctx, state)
    case 'PLpgSQL_stmt_fors':
      return printForQuery(value, ctx, state)
    case 'PLpgSQL_stmt_foreach_a':
      return printForeach(value, ctx, state)
    case 'PLpgSQL_stmt_exit':
      return printExit(value, ctx)
    case 'PLpgSQL_stmt_case':
      return printCase(value, ctx, state)
    case 'PLpgSQL_stmt_assert':
      return printAssert(value, ctx)
    case 'PLpgSQL_stmt_commit':
      return text('COMMIT;')
    case 'PLpgSQL_stmt_rollback':
      return text('ROLLBACK;')
    case 'PLpgSQL_stmt_null':
      return text('NULL;')
    default:
      throw new UnsupportedNodeError(kind ?? 'PLpgSQL statement')
  }
}

/**
 * Print IF/ELSIF/ELSE.
 * @param value
 * @param ctx
 * @param state
 */
function printIf(value: Record<string, unknown>, ctx: PrintContext, state: PlState): SqlDoc {
  const parts: SqlDoc[] = [concat(text('IF '), expressionDoc(exprQuery(value.cond), ctx), text(' THEN'))]
  const thenBody = (value.then_body as PlStmt[] | undefined) ?? []
  if (thenBody.length) parts.push(indent(concat(hardline(), joinHardline(thenBody, ctx, state))))
  for (const elsif of (value.elsif_list as unknown[] | undefined) ?? []) {
    const clause = bodyOf<{ cond?: unknown, stmts?: PlStmt[] }>(elsif)
    parts.push(hardline(), concat(text('ELSIF '), expressionDoc(exprQuery(clause.cond), ctx), text(' THEN')))
    if (clause.stmts?.length) parts.push(indent(concat(hardline(), joinHardline(clause.stmts, ctx, state))))
  }
  const elseBody = (value.else_body as PlStmt[] | undefined) ?? []
  if (elseBody.length) {
    parts.push(hardline(), text('ELSE'), indent(concat(hardline(), joinHardline(elseBody, ctx, state))))
  }
  parts.push(hardline(), text('END IF;'))
  return concat(...parts)
}

/**
 * Print an assignment.
 * @param value
 * @param ctx
 */
function printAssign(value: Record<string, unknown>, ctx: PrintContext): SqlDoc {
  const query = exprQuery(value.expr)
  const assignment = splitAssignment(query)
  if (!assignment) throw new UnsupportedNodeError('PLpgSQL_stmt_assign', 'missing assignment operator')
  return concat(
    expressionDoc(assignment.target, ctx),
    text(` ${assignment.operator} `),
    expressionDoc(assignment.value, ctx),
    text(';'),
  )
}

/**
 * Print RETURN.
 * @param value
 * @param ctx
 * @param state
 */
function printReturn(value: Record<string, unknown>, ctx: PrintContext, state: PlState): SqlDoc {
  const query = exprQuery(value.expr)
  if (query !== '') {
    return concat(
      group(concat(text('RETURN'), indent(concat(line(), expressionDoc(query, ctx))))),
      text(';'),
    )
  }
  const varno = value.retvarno
  if (typeof varno === 'number') {
    const datum = state.datums[varno]
    const kind = datum ? kindOf(datum) : null
    const body = datum ? bodyOf<{ refname?: string }>(datum) : null
    if (body?.refname) {
      const name = body.refname === 'new' || body.refname === 'old'
        ? body.refname.toUpperCase()
        : quoteIdentifier(body.refname)
      return text(`RETURN ${name};`)
    }
    if (kind === 'PLpgSQL_rec' || kind === 'PLpgSQL_var') return text('RETURN;')
  }
  return text('RETURN;')
}

/**
 * Print RAISE.
 * @param value
 * @param ctx
 */
function printRaise(value: Record<string, unknown>, ctx: PrintContext): SqlDoc {
  const levels: Record<number, string> = {
    10: 'DEBUG',
    11: 'DEBUG',
    12: 'DEBUG',
    13: 'DEBUG',
    14: 'DEBUG',
    15: 'LOG',
    17: 'INFO',
    18: 'NOTICE',
    19: 'WARNING',
    20: 'ERROR',
    21: 'EXCEPTION',
  }
  const level = levels[Number(value.elog_level ?? 18)] ?? 'NOTICE'
  const message = String(value.message ?? '').replace(/'/gu, "''")
  const params = ((value.params as unknown[] | undefined) ?? [])
    .map(param => exprQuery(param))
    .filter(query => query !== '')
  const suffix = params.length ? concat(text(', '), join(text(', '), params.map(query => expressionDoc(query, ctx)))) : empty
  return concat(text(`RAISE ${level} '${message}'`), suffix, text(';'))
}

/**
 * Print an embedded SQL statement.
 * @param value
 * @param ctx
 */
function printExecSql(value: Record<string, unknown>, ctx: PrintContext): SqlDoc {
  const query = exprQuery(value.sqlstmt)
  if (!query) throw new UnsupportedNodeError('PLpgSQL_stmt_execsql', 'missing SQL')
  const child = ctx.child(new SourceText(query))
  const parsed = parseSync(query)
  if (parsed.stmts.length !== 1) throw new UnsupportedNodeError('PLpgSQL_stmt_execsql', 'multiple statements')
  const statement = parsed.stmts[0]?.stmt as Node
  if (value.into && kindOf(statement) === 'SelectStmt') {
    const target = printPlTarget(value.target)
    const select = bodyOf<ValueOf<'SelectStmt'>>(statement)
    return concat(printSelect(select, child, { into: target }), text(';'))
  }
  return concat(child.print(statement), text(';'))
}

/**
 * Print PERFORM.
 * @param value
 * @param ctx
 */
function printPerform(value: Record<string, unknown>, ctx: PrintContext): SqlDoc {
  const query = exprQuery(value.expr)
  const parsed = parseSync(query)
  const statement = parsed.stmts[0]?.stmt as Node
  if (kindOf(statement) !== 'SelectStmt') throw new UnsupportedNodeError('PLpgSQL_stmt_perform', 'non-select')
  const select = bodyOf<ValueOf<'SelectStmt'>>(statement)
  const child = ctx.child(new SourceText(query))
  const targets = (select.targetList ?? []).map(target => printResTarget(bodyOf<ValueOf<'ResTarget'>>(target), child))
  return concat(text('PERFORM '), join(text(', '), targets), text(';'))
}

/**
 * Print dynamic EXECUTE.
 * @param value
 * @param ctx
 */
function printDynamicExecute(value: Record<string, unknown>, ctx: PrintContext): SqlDoc {
  const query = expressionDoc(exprQuery(value.query), ctx)
  const parts: SqlDoc[] = [text('EXECUTE '), query]
  if (value.into) parts.push(text(' INTO '), printPlTarget(value.target))
  const params = ((value.params as unknown[] | undefined) ?? [])
    .map(param => exprQuery(param))
    .filter(item => item !== '')
  if (params.length) parts.push(text(' USING '), join(text(', '), params.map(param => expressionDoc(param, ctx))))
  parts.push(text(';'))
  return concat(...parts)
}

/**
 * Print LOOP/WHILE.
 * @param value
 * @param ctx
 * @param state
 * @param keyword
 * @param suffix
 */
function printLoop(value: Record<string, unknown>, ctx: PrintContext, state: PlState, keyword: string, suffix: SqlDoc): SqlDoc {
  const body = (value.body as PlStmt[] | undefined) ?? []
  return concat(
    text(keyword),
    suffix === empty ? text('') : concat(text(' '), suffix),
    body.length ? indent(concat(hardline(), joinHardline(body, ctx, state))) : empty,
    hardline(),
    text('END LOOP;'),
  )
}

/**
 * Print FOR i IN a..b LOOP.
 * @param value
 * @param ctx
 * @param state
 */
function printForInteger(value: Record<string, unknown>, ctx: PrintContext, state: PlState): SqlDoc {
  const name = plTargetName(value.var)
  const reverse = value.reverse ? ' REVERSE' : ''
  const step = value.step ? concat(text(' BY '), expressionDoc(exprQuery(value.step), ctx)) : empty
  const body = (value.body as PlStmt[] | undefined) ?? []
  return concat(
    text(`FOR ${name} IN${reverse} `),
    expressionDoc(exprQuery(value.lower), ctx),
    text('..'),
    expressionDoc(exprQuery(value.upper), ctx),
    step,
    text(' LOOP'),
    body.length ? indent(concat(hardline(), joinHardline(body, ctx, state))) : empty,
    hardline(),
    text('END LOOP;'),
  )
}

/**
 * Print FOR row IN query LOOP.
 * @param value
 * @param ctx
 * @param state
 */
function printForQuery(value: Record<string, unknown>, ctx: PrintContext, state: PlState): SqlDoc {
  const name = plTargetName(value.var)
  const body = (value.body as PlStmt[] | undefined) ?? []
  return concat(
    text(`FOR ${name} IN `),
    expressionDoc(exprQuery(value.query), ctx),
    text(' LOOP'),
    body.length ? indent(concat(hardline(), joinHardline(body, ctx, state))) : empty,
    hardline(),
    text('END LOOP;'),
  )
}

/**
 * Print FOREACH.
 * @param value
 * @param ctx
 * @param state
 */
function printForeach(value: Record<string, unknown>, ctx: PrintContext, state: PlState): SqlDoc {
  const name = plTargetName(value.var)
  const slice = value.slice ? ` SLICE ${value.slice}` : ''
  const body = (value.body as PlStmt[] | undefined) ?? []
  return concat(
    text(`FOREACH ${name}${slice} IN ARRAY `),
    expressionDoc(exprQuery(value.expr), ctx),
    text(' LOOP'),
    body.length ? indent(concat(hardline(), joinHardline(body, ctx, state))) : empty,
    hardline(),
    text('END LOOP;'),
  )
}

/**
 * Print EXIT/CONTINUE.
 * @param value
 * @param ctx
 */
function printExit(value: Record<string, unknown>, ctx: PrintContext): SqlDoc {
  const keyword = value.is_exit ? 'EXIT' : 'CONTINUE'
  const label = value.label ? ` ${value.label}` : ''
  const condition = value.cond ? concat(text(' WHEN '), expressionDoc(exprQuery(value.cond), ctx)) : empty
  return concat(text(`${keyword}${label}`), condition, text(';'))
}

/**
 * Print a CASE statement.
 * @param value
 * @param ctx
 * @param state
 */
function printCase(value: Record<string, unknown>, ctx: PrintContext, state: PlState): SqlDoc {
  const test = value.t_expr ? concat(text('CASE '), expressionDoc(exprQuery(value.t_expr), ctx)) : text('CASE')
  const clauses: SqlDoc[] = []
  for (const entry of (value.case_when_list as unknown[] | undefined) ?? []) {
    const clause = bodyOf<{ expr?: unknown, stmts?: PlStmt[] }>(entry)
    const when = value.t_expr
      ? caseWhenValue(exprQuery(clause.expr), ctx)
      : expressionDoc(exprQuery(clause.expr), ctx)
    clauses.push(concat(
      text('WHEN '),
      when,
      text(' THEN'),
      clause.stmts?.length ? indent(concat(hardline(), joinHardline(clause.stmts, ctx, state))) : empty,
    ))
  }
  if (value.have_else) {
    const elseStmts = (value.else_stmts as PlStmt[] | undefined) ?? []
    clauses.push(concat(
      text('ELSE'),
      elseStmts.length ? indent(concat(hardline(), joinHardline(elseStmts, ctx, state))) : empty,
    ))
  }
  return concat(test, indent(concat(hardline(), join(hardline(), clauses))), hardline(), text('END CASE;'))
}

/**
 * Print ASSERT.
 * @param value
 * @param ctx
 */
function printAssert(value: Record<string, unknown>, ctx: PrintContext): SqlDoc {
  const message = value.message ? concat(text(', '), expressionDoc(exprQuery(value.message), ctx)) : empty
  return concat(text('ASSERT '), expressionDoc(exprQuery(value.cond), ctx), message, text(';'))
}

/**
 * Join PL statements with the control-flow blank-line convention.
 * @param statements
 * @param ctx
 * @param state
 */
function joinHardline(statements: readonly PlStmt[], ctx: PrintContext, state: PlState): SqlDoc {
  const parts: SqlDoc[] = []
  let previous: string | null = null
  for (const statement of statements) {
    if (isImplicitReturn(statement)) continue
    if (parts.length > 0) {
      parts.push(hardline())
      if (isControlStatement(previous)) parts.push(hardline())
    }
    const statementLine = bodyOf<{ lineno?: number }>(statement).lineno ?? 0
    for (const comment of takeCommentsBefore(state, statementLine)) parts.push(text(comment), hardline())
    parts.push(printPlStmt(statement, ctx, state))
    previous = kindOf(statement)
  }
  return concat(...parts)
}

/**
 * Read an expression query from a PL expression wrapper.
 * @param value
 */
function exprQuery(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  if (kindOf(value) !== 'PLpgSQL_expr') return ''
  return bodyOf<PlExpr>(value).query ?? ''
}

/**
 * Print a PL target name.
 * @param value
 */
function printPlTarget(value: unknown): SqlDoc {
  if (!value || typeof value !== 'object') return text('')
  const datum = bodyOf<Record<string, unknown>>(value)
  const refname = datum.refname
  if (typeof refname === 'string' && refname !== '(unnamed row)') return text(quoteIdentifier(refname))
  const fields = datum.fields as { name?: string }[] | undefined
  const names = (fields ?? []).map(field => field.name ?? '').filter(name => name !== '')
  return text(names.map(quoteIdentifier).join(', '))
}

/**
 * Read a PL target's name.
 * @param value
 */
function plTargetName(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const datum = bodyOf<Record<string, unknown>>(value)
  const refname = datum.refname
  if (typeof refname === 'string' && refname !== '(unnamed row)') return refname
  const fields = datum.fields as { name?: string }[] | undefined
  if (fields?.length) {
    return fields.map(field => field.name ?? '').filter(name => name !== '').join(', ')
  }
  return ''
}

/**
 * Print a value from a simple CASE WHEN expression.
 * @param query
 * @param ctx
 */
function caseWhenValue(query: string, ctx: PrintContext): SqlDoc {
  try {
    const parsed = parseSync(`SELECT ${query}`)
    const select = bodyOf<ValueOf<'SelectStmt'>>(parsed.stmts[0]?.stmt as Node)
    const target = select.targetList?.[0]
    if (!target) return expressionDoc(query, ctx)
    const expression = bodyOf<ValueOf<'ResTarget'>>(target).val as Node
    if (kindOf(expression) === 'A_Expr') {
      const binary = bodyOf<ValueOf<'A_Expr'>>(expression)
      if (binary.kind === 'AEXPR_IN') {
        const items = bodyOf<{ items?: Node[] }>(binary.rexpr as Node).items ?? []
        if (items.length === 1) return ctx.print(items[0] as Node)
      }
    }
    return ctx.print(expression)
  } catch {
    return expressionDoc(query, ctx)
  }
}

/**
 * Print an embedded expression by parsing it through the SQL printer.
 * @param query
 * @param ctx
 */
function expressionDoc(query: string, ctx: PrintContext): SqlDoc {
  if (query === '') throw new UnsupportedNodeError('PLpgSQL expression', 'empty')
  for (const candidate of [query, `SELECT ${query}`]) {
    try {
      const parsed = parseSync(candidate)
      if (parsed.stmts.length !== 1) continue
      const statement = parsed.stmts[0]?.stmt as Node
      if (kindOf(statement) !== 'SelectStmt') {
        return ctx.child(new SourceText(candidate)).print(statement)
      }
      const select = bodyOf<ValueOf<'SelectStmt'>>(statement)
      if (candidate === `SELECT ${query}` && select.targetList?.length === 1
        && !select.fromClause?.length && !select.whereClause && !select.groupClause?.length
        && !select.havingClause && !select.sortClause?.length && !select.limitCount && !select.limitOffset
        && select.op === 'SETOP_NONE') {
        return ctx.child(new SourceText(candidate)).print(bodyOf<ValueOf<'ResTarget'>>(select.targetList[0] as Node).val as Node)
      }
      if (candidate === query) return ctx.child(new SourceText(candidate)).print(statement)
    } catch {
      // Try the expression-shaped candidate next.
    }
  }
  throw new UnsupportedNodeError('PLpgSQL expression', query.slice(0, 40))
}

/**
 * Split an assignment query at its top-level assignment operator.
 * @param query
 */
function splitAssignment(query: string): { operator: string, target: string, value: string } | null {
  const source = new SourceText(query)
  let depth = 0
  for (const token of source.tokens) {
    if (token.text === '(' || token.text === '[') depth += 1
    else if (token.text === ')' || token.text === ']') depth -= 1
    else if (depth === 0 && (token.text === ':=' || token.text === '=')) {
      const target = query.slice(0, token.start).trim()
      const value = query.slice(token.end).trim()
      if (target && value) return { operator: token.text, target, value }
    }
  }
  return null
}

/**
 * Print a PL/pgSQL type name.
 * @param datatype
 */
function plType(datatype: unknown): SqlDoc {
  const type = datatype && typeof datatype === 'object' && kindOf(datatype) === 'PLpgSQL_type'
    ? bodyOf<{ typname?: string }>(datatype)
    : undefined
  const name = type?.typname ?? 'record'
  const array = name.endsWith('[]') ? '[]' : ''
  const base = array === '' ? name : name.slice(0, -2)
  const mapped: Record<string, string> = {
    bool: 'BOOLEAN',
    float4: 'REAL',
    float8: 'DOUBLE PRECISION',
    int: 'INTEGER',
    int2: 'SMALLINT',
    int4: 'INTEGER',
    int8: 'BIGINT',
    integer: 'INTEGER',
    numeric: 'NUMERIC',
    text: 'TEXT',
    timestamp: 'TIMESTAMP',
    timestamptz: 'TIMESTAMP WITH TIME ZONE',
    uuid: 'UUID',
    varchar: 'VARCHAR',
  }
  return text(`${mapped[base.toLowerCase()] ?? quoteIdentifier(base)}${array}`)
}

/**
 * Choose a dollar-quote tag that does not occur in the body.
 * @param body
 */
function dollarTag(body: string): string {
  if (!body.includes('$$')) return '$$'
  for (const tag of ['$basis$', '$fn$', '$body$']) {
    if (!body.includes(tag)) return tag
  }
  throw new UnsupportedNodeError('DO/function body', 'dollar quote collision')
}
