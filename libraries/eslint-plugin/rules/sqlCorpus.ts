/* eslint-disable @typescript-eslint/no-explicit-any -- TypeScript compiler and parser AST boundary. */
import { loadModule, parsePlPgSQLSync, parseSync } from 'libpg-query'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type * as TypeScript from 'typescript'
import { formatSQL, formatSQLResult } from './sqlTemplateFormat'

const require = createRequire(import.meta.url)
const ts = require(path.resolve('node_modules/typescript/lib/typescript.js')) as typeof TypeScript

const ROOTS = ['libraries', 'consumer', 'testing', 'scripts']
const EXCLUDED = /(?:^|[/.])(?:node_modules|dist|\.cache|generated)(?:[/.]|$)/
const TEST_FILE = /\.(?:test|e2e|screenshot|lifecycle|hmr)\.(?:ts|tsx)$/u

/** One discovered corpus SQL string. */
export interface CorpusCandidate {
  file: string,
  source: string,
  sql: string,
}

/** One corpus issue. */
export interface CorpusIssue {
  construct?: string,
  file: string,
  sql: string,
}

/** Scanner output used by the coverage gate and the coverage script. */
export interface CorpusReport {
  candidates: number,
  idempotenceFailures: CorpusIssue[],
  invalidFormatted: CorpusIssue[],
  nodes: Map<string, Set<string>>,
  parseFailures: CorpusIssue[],
  plNodes: Set<string>,
  plSemanticFailures: CorpusIssue[],
  runtimeFixtures: number,
  runtimeSites: string[],
  semanticFailures: CorpusIssue[],
  sources: number,
  unresolved: CorpusIssue[],
  unsupported: CorpusIssue[],
  variants: Map<string, Set<string>>,
}

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
 * Read a statically composed SQL expression.
 * @param node - TypeScript expression.
 * @returns SQL text, or null when the expression is not statically readable.
 */
function staticSql(node: any): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return templateSql(node)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticSql(node.left)
    const right = staticSql(node.right)
    return left === null || right === null ? null : left + right
  }
  return null
}

/**
 * Normalize parsed SQL meaning for equivalence checks.
 * @param value - Parsed AST value.
 * @returns AST without source metadata.
 */
export function sqlSemantics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sqlSemantics)
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (key === 'location' || key === 'stmt_location' || key === 'stmt_len'
        || key.endsWith('_start') || key.endsWith('_end')) continue
      result[key] = sqlSemantics(child)
    }
    return result
  }
  return value
}

/**
 * Canonicalize a PL/pgSQL executable expression.
 * @param query - Raw expression SQL.
 * @returns Normalized expression text.
 */
function canonicalPlQuery(query: string): string {
  for (const candidate of [query, `SELECT ${query}`]) {
    try {
      const parsed: any = parseSync(candidate)
      if (parsed.stmts?.length) return JSON.stringify(sqlSemantics(parsed.stmts.map((stmt: any) => stmt.stmt)))
    } catch {
      // Try the next expression shape, then fall back to lexical normalization.
    }
  }
  const assignment = /^(.*?)\s*(:=|=)\s*([\s\S]*)$/u.exec(query)
  if (assignment) {
    return `${assignment[1]?.trim().toLowerCase()} ${assignment[2]} ${canonicalPlQuery(assignment[3] ?? '')}`
  }
  return query.replace(/\s+/gu, ' ').trim().toLowerCase()
}

/**
 * Normalize PL/pgSQL meaning for structural equivalence checks.
 * @param value - PL/pgSQL AST value.
 * @returns AST without source and expression-text metadata.
 */
export function plSemantics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plSemantics)
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (key === 'location' || key === 'lineno' || key === 'stmt_location' || key === 'stmt_len'
        || key === 'dno' || key === 'varno' || key === 't_varno'
        || key === 'retvarno' || key === 'old_varno' || key === 'new_varno'
        || key === 'found_varno' || key === 'out_param_varno'
        || key.endsWith('_start') || key.endsWith('_end')) continue
      if (key === 'query' && typeof child === 'string') {
        result[key] = canonicalPlQuery(child)
        continue
      }
      if (key === 'datums' && Array.isArray(child)) {
        result[key] = child
          .filter((datum: any) => !/^__case__variable_\d+__$/iu.test(datum?.PLpgSQL_var?.refname ?? ''))
          .map(plSemantics)
        continue
      }
      result[key] = plSemantics(child)
    }
    return result
  }
  return typeof value === 'string' ? value.toLowerCase() : value
}

/**
 * Collect node tags and meaningful fields from an AST.
 * @param node - AST node.
 * @param nodes - Node/field inventory.
 * @param variants - Variant inventory.
 * @param pl - Whether this is a PL/pgSQL tree.
 */
function collectNodes(
  node: any,
  nodes: Map<string, Set<string>>,
  variants: Map<string, Set<string>>,
  pl = false,
): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) collectNodes(child, nodes, variants, pl)
    return
  }
  const type = Object.keys(node).find(key => (
    /^[A-Z]/u.test(key) && node[key] && typeof node[key] === 'object' && !Array.isArray(node[key])
  ))
  if (type) {
    const fields = nodes.get(type) ?? new Set<string>()
    nodes.set(type, fields)
    for (const [key, value] of Object.entries(node[type])) {
      if (key === 'location' || key === 'lineno' || key === 'stmt_location' || key === 'stmt_len') continue
      fields.add(key)
      if (typeof value === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(value)) {
        const variantKey = `${type}.${key}`
        const values = variants.get(variantKey) ?? new Set<string>()
        values.add(value)
        variants.set(variantKey, values)
      }
      collectNodes(value, nodes, variants, pl)
    }
  } else {
    for (const value of Object.values(node)) collectNodes(value, nodes, variants, pl)
  }
}

/**
 * Discover and verify the production SQL corpus.
 * @param extra - Additional candidates used by coverage regression tests.
 * @param runtimeSites - Call-site identities covered by executed runtime producers.
 * @returns Executable corpus report.
 */
export async function scanProductionCorpus(
  extra: readonly CorpusCandidate[] = [],
  runtimeSites: readonly string[] = [],
): Promise<CorpusReport> {
  await loadModule()
  const report: CorpusReport = {
    candidates: 0,
    idempotenceFailures: [],
    invalidFormatted: [],
    nodes: new Map(),
    parseFailures: [],
    plNodes: new Set(),
    plSemanticFailures: [],
    runtimeFixtures: 0,
    runtimeSites: [],
    semanticFailures: [],
    sources: 0,
    unresolved: [],
    unsupported: [],
    variants: new Map(),
  }
  const candidates: CorpusCandidate[] = []
  const add = (file: string, sql: string, source: string): void => {
    if (!sql.trim()) return
    candidates.push({ file, source, sql })
  }
  for (const candidate of extra) add(candidate.file, candidate.sql, candidate.source)
  report.runtimeFixtures = extra.filter(candidate => candidate.source === 'runtime').length
  for (const file of ROOTS.flatMap(sourceFiles)) {
    report.sources += 1
    if (file.endsWith('.sql')) {
      add(file, fs.readFileSync(file, 'utf8'), 'file')
      continue
    }
    const source = fs.readFileSync(file, 'utf8')
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
    const visit = (node: TypeScript.Node): void => {
      if (ts.isTaggedTemplateExpression(node) && /(?:^|\.)sql(?:\.(?:unsafe|raw))?$/iu.test(node.tag.getText())) {
        add(file, templateSql(node.template), 'template')
      } else if (ts.isCallExpression(node) && /\.(?:unsafe|raw)$/u.test(node.expression.getText())) {
        const argument = node.arguments[0]
        const sql = argument ? staticSql(argument) : null
        if (sql !== null) {
          add(file, sql, 'call')
        } else if (runtimeSites.includes(argument?.getText() ?? '')) {
          report.runtimeSites.push(argument?.getText() ?? '')
        } else {
          report.unresolved.push({ file, sql: node.getText().slice(0, 240) })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(parsed)
  }
  report.candidates = candidates.length
  for (const candidate of candidates) {
    const { file, sql } = candidate
    let original: any
    try {
      original = parseSync(sql)
    } catch {
      if (candidate.source === 'template' || candidate.source === 'call' || candidate.source === 'file') {
        report.parseFailures.push({ file, sql: sql.slice(0, 240) })
      } else {
        report.unresolved.push({ file, sql: sql.slice(0, 240) })
      }
      continue
    }
    collectNodes(original.stmts?.map((statement: any) => statement.stmt), report.nodes, report.variants)
    const result = formatSQLResult(sql)
    if (result.status !== 'formatted') {
      report.unsupported.push({
        construct: result.unsupported ?? result.error ?? 'unknown',
        file,
        sql: sql.slice(0, 240),
      })
      continue
    }
    if (formatSQL(result.formatted) !== result.formatted) {
      report.idempotenceFailures.push({ file, sql: sql.slice(0, 240) })
    }
    let formatted: any
    try {
      formatted = parseSync(result.formatted)
    } catch {
      report.invalidFormatted.push({ file, sql: sql.slice(0, 240) })
      continue
    }
    const containsPl = (original.stmts ?? []).some((statement: any) => (
      statement.stmt?.CreateFunctionStmt || statement.stmt?.DoStmt
    ))
    if (!containsPl
      && JSON.stringify(sqlSemantics(original.stmts?.map((statement: any) => statement.stmt))) !==
        JSON.stringify(sqlSemantics(formatted.stmts?.map((statement: any) => statement.stmt)))) {
      report.semanticFailures.push({ file, sql: sql.slice(0, 240) })
    }
    if (containsPl) {
      try {
        const originalPl: any = parsePlPgSQLSync(sql)
        const formattedPl: any = parsePlPgSQLSync(result.formatted)
        collectNodes(originalPl, report.nodes, report.variants, true)
        if (originalPl.plpgsql_funcs?.length) report.plNodes.add('PLpgSQL_function')
        if (JSON.stringify(plSemantics(originalPl)) !== JSON.stringify(plSemantics(formattedPl))) {
          report.plSemanticFailures.push({ file, sql: sql.slice(0, 240) })
        }
      } catch {
        report.plSemanticFailures.push({ file, sql: sql.slice(0, 240) })
      }
    }
  }
  return report
}
