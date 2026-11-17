/* eslint-disable @typescript-eslint/no-explicit-any -- TypeScript compiler AST boundary. */
import { describe, expect, test } from 'bun:test'
import { loadModule, parseSync } from 'libpg-query'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type * as TypeScript from 'typescript'
import { formatSQL, formatSQLResult } from './sqlTemplateFormat'

const require = createRequire(import.meta.url)
const ts = require(path.resolve('node_modules/typescript/lib/typescript.js')) as typeof TypeScript

await loadModule()

const ROOTS = ['libraries', 'consumer', 'testing', 'scripts']
const EXCLUDED = /(?:^|[/.])(?:node_modules|dist|\.cache|generated)(?:[/.]|$)/
const TEST_FILE = /\.(?:test|e2e|screenshot|lifecycle|hmr)\.(?:ts|tsx)$/u
const SQL_START = new RegExp(
  '^\\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|DO|BEGIN|SET|COMMENT|GRANT|REVOKE|' +
    'VACUUM|ANALYZE|TRUNCATE|MERGE|CALL|EXPLAIN|COPY|LOCK|LISTEN|NOTIFY|UNLISTEN|REFRESH|REINDEX|' +
    'CLUSTER|DISCARD|PREPARE|EXECUTE|DEALLOCATE|DECLARE|FETCH|CLOSE|MOVE|REASSIGN|SECURITY|' +
    'IMPORT|CHECKPOINT|LOAD|RESET|SHOW)\\b',
  'iu',
)

/**
 * Recursively collect source files under a root.
 * @param root - Directory root.
 * @returns Source file paths.
 */
function sourceFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const result: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (EXCLUDED.test(full)) continue
    if (entry.isDirectory()) result.push(...sourceFiles(full))
    else if (/\.(?:ts|tsx|sql)$/u.test(entry.name) && !TEST_FILE.test(full)) result.push(full)
  }
  return result
}

/**
 * Convert a template literal to parseable SQL.
 * @param quasi - TypeScript template literal.
 * @returns SQL text with interpolation placeholders.
 */
function templateSql(quasi: any): string {
  if (ts.isNoSubstitutionTemplateLiteral(quasi)) return quasi.text
  let sql = quasi.head.text
  quasi.templateSpans.forEach((span: any, index: number) => {
    sql += `__basis_p${index}__${span.literal.text}`
  })
  return sql
}

/**
 * Normalize parsed meaning for equivalence checks.
 * @param value - Parsed AST value.
 * @returns AST without source metadata.
 */
function semantics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantics)
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (key === 'location' || key === 'stmt_location' || key === 'stmt_len'
        || key.endsWith('_start') || key.endsWith('_end')) continue
      result[key] = semantics(child)
    }
    return result
  }
  return value
}

describe('production SQL corpus', () => {
  test('formats every statically discoverable production statement', () => {
    const unsupported: { construct: string, file: string, sql: string }[] = []
    const invalid: { file: string, formatted: string, sql: string }[] = []
    const semanticDiffs: { file: string, sql: string }[] = []
    const idempotenceDiffs: { file: string, sql: string }[] = []
    const inspect = (file: string, sql: string): void => {
      if (!sql.trim()) return
      let original: any
      try {
        original = parseSync(sql)
      } catch {
        return
      }
      const result = formatSQLResult(sql)
      if (result.unsupported) {
        unsupported.push({ construct: result.unsupported, file, sql: sql.slice(0, 240) })
        return
      }
      if (formatSQL(result.formatted) !== result.formatted) {
        idempotenceDiffs.push({ file, sql: sql.slice(0, 240) })
      }
      try {
        const formatted = parseSync(result.formatted)
        const containsPl = (original.stmts ?? []).some((statement: any) => (
          statement.stmt?.CreateFunctionStmt || statement.stmt?.DoStmt
        ))
        if (!containsPl
          && JSON.stringify(semantics(original.stmts?.map((statement: any) => statement.stmt))) !==
            JSON.stringify(semantics(formatted.stmts?.map((statement: any) => statement.stmt)))) {
          semanticDiffs.push({ file, sql: sql.slice(0, 240) })
        }
      } catch {
        invalid.push({ file, formatted: result.formatted.slice(0, 240), sql: sql.slice(0, 240) })
      }
    }
    for (const file of ROOTS.flatMap(sourceFiles)) {
      if (file.endsWith('.sql')) {
        inspect(file, fs.readFileSync(file, 'utf8'))
        continue
      }
      const source = fs.readFileSync(file, 'utf8')
      const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
      const visit = (node: TypeScript.Node): void => {
        if (ts.isTaggedTemplateExpression(node) && /sql|unsafe|raw/iu.test(node.tag.getText())) {
          inspect(file, templateSql(node.template))
        } else if (ts.isCallExpression(node) && /\.(?:unsafe|raw|simple)$/u.test(node.expression.getText())) {
          const argument = node.arguments[0]
          if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
            inspect(file, argument.text)
          }
        } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
          && SQL_START.test(node.text)) {
          inspect(file, node.text)
        }
        ts.forEachChild(node, visit)
      }
      visit(parsed)
    }
    expect(unsupported).toEqual([])
    expect(invalid).toEqual([])
    expect(semanticDiffs).toEqual([])
    expect(idempotenceDiffs).toEqual([])
  })
})
