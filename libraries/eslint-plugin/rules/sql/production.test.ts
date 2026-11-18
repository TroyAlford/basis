/* eslint-disable @stylistic/max-len -- SQL fixtures and protocol field names need long lines. */
import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type * as TypeScript from 'typescript'
import { formatSQL } from './format'
import { sqlSemanticTree } from './verify'

const require = createRequire(import.meta.url)
const ts = require(path.resolve('node_modules/typescript/lib/typescript.js')) as typeof TypeScript

const ROOTS = ['libraries', 'consumer', 'testing', 'scripts']
const EXCLUDED = /(?:^|[/.])(?:node_modules|dist|\.cache|generated)(?:[/.]|$)/u

/**
 * Collect TypeScript and TSX source files.
 * @param root
 */
function sourceFiles(root: string): string[] {
  const result: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (EXCLUDED.test(full)) continue
    if (entry.isDirectory()) result.push(...sourceFiles(full))
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) result.push(full)
  }
  return result
}

/**
 * Turn a template literal into parseable SQL with stable placeholders.
 * @param quasi
 */
function templateSql(quasi: TypeScript.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(quasi)) return quasi.text
  let sql = quasi.head.text
  quasi.templateSpans.forEach((span, index) => {
    sql += `__basis_param_${index}__${span.literal.text}`
  })
  return sql
}

/** Collect every SQL tagged template the rule governs. */
function productionTemplates(): { file: string, sql: string }[] {
  const templates: { file: string, sql: string }[] = []
  for (const file of ROOTS.flatMap(sourceFiles)) {
    const source = fs.readFileSync(file, 'utf8')
    const parsed = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const visit = (node: TypeScript.Node): void => {
      if (ts.isTaggedTemplateExpression(node) && /(?:^|\.)sql$/iu.test(node.tag.getText())) {
        templates.push({ file, sql: templateSql(node.template) })
      }
      ts.forEachChild(node, visit)
    }
    visit(parsed)
  }
  return templates
}

describe('repository SQL templates', () => {
  test('every currently governed template formats, preserves meaning, and is idempotent', () => {
    const templates = productionTemplates()
    expect(templates.length).toBeGreaterThan(0)
    const failures: string[] = []
    for (const template of templates) {
      const result = formatSQL(template.sql)
      if (result.status !== 'formatted') {
        failures.push(`${template.file}: ${result.status} ${JSON.stringify(result)}`)
        continue
      }
      try {
        expect(sqlSemanticTree(result.sql)).toEqual(sqlSemanticTree(template.sql))
      } catch {
        failures.push(`${template.file}: meaning changed`)
      }
      const twice = formatSQL(result.sql)
      if (twice.status !== 'formatted' || twice.sql !== result.sql) {
        failures.push(`${template.file}: not idempotent`)
      }
    }
    expect(failures).toEqual([])
  })
})
