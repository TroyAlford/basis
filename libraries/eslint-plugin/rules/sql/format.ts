/* eslint-disable camelcase */
import type { Node } from 'libpg-query'
import { loadModule, parsePlPgSQLSync, parseSync, scanSync } from 'libpg-query'
import type { SqlDoc } from './doc'
import { concat, hardline, join, render, text } from './doc'
import type { PlFunction } from './plpgsql'
import { createPrinter } from './printer'
import { SourceText } from './source'
import { kindOf, SemanticError, UnsupportedNodeError } from './types'
import { verifySemantics } from './verify'

await loadModule()

/** Result of formatting one SQL template body. */
export type SqlFormatResult =
  | { construct: string, status: 'unsupported' }
  | { reason: string, status: 'invalid' }
  | { sql: string, status: 'formatted' }

/** A decoded interpolation placeholder. */
interface Placeholder {
  original: string,
  safe: string,
}

/**
 * Format one SQL string.
 *
 * Parses, prints, renders, and verifies before returning a successful result.
 * Unsupported syntax and internal or parser failures are explicit non-fixable
 * outcomes; no partial SQL is ever returned as formatted.
 * @param sql
 */
export function formatSQL(sql: string): SqlFormatResult {
  let encoded: { placeholders: Placeholder[], safeSql: string }
  try {
    encoded = encodePlaceholders(sql)
  } catch (error) {
    if (error instanceof UnsupportedNodeError) return { construct: error.nodeKind, status: 'unsupported' }
    return { reason: describe(error), status: 'invalid' }
  }
  const { placeholders, safeSql } = encoded
  let parsed: ReturnType<typeof parseSync>
  try {
    parsed = parseSync(safeSql)
  } catch (error) {
    return { reason: describe(error), status: 'invalid' }
  }
  if (!parsed.stmts?.length) return { sql: '', status: 'formatted' }

  let plFunctions: PlFunction[] = []
  const hasPl = parsed.stmts.some(statement => {
    const kind = kindOf(statement.stmt as Node)
    return kind === 'CreateFunctionStmt' || kind === 'DoStmt'
  })
  if (hasPl) {
    try {
      const pl = parsePlPgSQLSync(safeSql) as { plpgsql_funcs?: { PLpgSQL_function?: PlFunction }[] }
      plFunctions = (pl.plpgsql_funcs ?? [])
        .map(fn => fn.PLpgSQL_function)
        .filter((fn): fn is PlFunction => fn !== undefined)
    } catch (error) {
      return { construct: describe(error), status: 'unsupported' }
    }
  }

  const source = new SourceText(safeSql)
  const context = createPrinter(source, plFunctions, new Set(placeholders.map(placeholder => placeholder.safe)))
  let rendered: string
  try {
    const documents: SqlDoc[] = []
    let previousEnd = 0
    parsed.stmts.forEach((statement, index) => {
      const start = statement.stmt_location ?? 0
      const end = statement.stmt_len === undefined ? safeSql.length : start + statement.stmt_len
      const nextStart = parsed.stmts[index + 1]?.stmt_location ?? safeSql.length
      const leading = source.takeComments(previousEnd, start)
      const nodeEnd = source.span(statement.stmt as Node)?.end ?? start
      context.statementEnd = nodeEnd
      const body = context.print(statement.stmt as Node)
      if (index > 0) documents.push(hardline(), hardline())
      if (leading.length > 0) {
        documents.push(join(hardline(), leading.map(comment => text(comment.text))), hardline())
      }
      documents.push(body)
      if (index < parsed.stmts.length - 1) documents.push(text(';'))
      const inline = source.takeInlineComments(source.lineAt(nodeEnd), nodeEnd, nextStart)
      if (inline.length > 0) documents.push(text(` ${inline[0]?.text}`))
      if (inline.length > 1) {
        documents.push(hardline(), join(hardline(), inline.slice(1).map(comment => text(comment.text))))
      }
      previousEnd = end
    })
    const remaining = source.takeComments(0, safeSql.length)
    if (remaining.length > 0) {
      documents.push(hardline(), join(hardline(), remaining.map(comment => text(comment.text))))
    }
    rendered = render(concat(...documents))
  } catch (error) {
    if (error instanceof UnsupportedNodeError) {
      return { construct: error.nodeKind, status: 'unsupported' }
    }
    return { reason: describe(error), status: 'invalid' }
  }

  if (source.commentsRemaining > 0) {
    return { reason: 'formatter did not preserve every comment', status: 'invalid' }
  }

  try {
    verifySemantics(safeSql, rendered)
  } catch (error) {
    if (error instanceof SemanticError) return { reason: error.message, status: 'invalid' }
    return { reason: describe(error), status: 'invalid' }
  }

  let restored = rendered
  for (const placeholder of placeholders) {
    if (countOccurrences(restored, placeholder.safe) !== 1) {
      return { reason: 'formatter changed an interpolation placeholder', status: 'invalid' }
    }
    restored = restored.replace(placeholder.safe, placeholder.original)
  }
  return { sql: restored, status: 'formatted' }
}

/**
 * Encode control-character interpolation placeholders as parseable identifiers.
 *
 * The adapter inserts `\u0001N\u0001` markers. A safe identifier is chosen so
 * it cannot collide with any text already in the SQL, and each marker must
 * survive as a standalone token (or inside the literal/comment that contained
 * it) before the result is accepted.
 * @param sql
 */
function encodePlaceholders(sql: string): { placeholders: Placeholder[], safeSql: string } {
  // Control characters deliberately delimit opaque template interpolations.
  // eslint-disable-next-line no-control-regex
  const pattern = /\u0001(\d+)\u0001/gu
  const placeholders: Placeholder[] = []
  let safeSql = ''
  let last = 0
  for (const match of sql.matchAll(pattern)) {
    const index = Number(match[1])
    const original = match[0]
    let safe = `__basis_param_${index}__`
    while (sql.includes(safe)) safe += '_'
    safeSql += sql.slice(last, match.index) + safe
    last = (match.index ?? 0) + original.length
    placeholders.push({ original, safe })
  }
  safeSql += sql.slice(last)
  if (placeholders.length > 0) verifyPlaceholderTokens(safeSql, placeholders)
  return { placeholders, safeSql }
}

/**
 * Ensure each placeholder is a standalone identifier or sits inside a literal/comment.
 * @param sql
 * @param placeholders
 */
function verifyPlaceholderTokens(sql: string, placeholders: readonly Placeholder[]): void {
  const tokens = scanSync(sql).tokens
  for (const placeholder of placeholders) {
    const exact = tokens.find(token => token.text === placeholder.safe)
    if (exact) continue
    const inside = tokens.some(token => (
      (token.tokenName === 'SCONST' || token.tokenName === 'SQL_COMMENT' || token.tokenName === 'C_COMMENT')
      && token.text.includes(placeholder.safe)
    ))
    if (!inside) throw new UnsupportedNodeError('interpolation')
  }
}

/**
 * Count non-overlapping occurrences of text.
 * @param value
 * @param needle
 */
function countOccurrences(value: string, needle: string): number {
  let count = 0
  let index = value.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = value.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * Describe an unknown error.
 * @param error
 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
