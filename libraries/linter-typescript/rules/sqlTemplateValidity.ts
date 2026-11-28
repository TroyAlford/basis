import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { loadModule, parsePlPgSQLSync, parseSync } from 'libpg-query'
import { extractSqlTemplate, isSqlTag } from './sql/template'

await loadModule()

/** Report SQL templates that the PostgreSQL parser cannot parse. */
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

/** Whether any statement carries a PL/pgSQL body. */
function hasPlPgSql(statements: readonly unknown[]): boolean {
  return statements.some(statement => {
    const kind = kindOf(statement)
    if (kind === 'DoStmt') {
      const body = bodyOf<{ args?: unknown[] }>(statement)
      return language(body.args) === undefined || language(body.args) === 'plpgsql'
    }
    if (kind === 'CreateFunctionStmt') {
      const body = bodyOf<{ options?: unknown[] }>(statement)
      return language(body.options) === 'plpgsql'
    }
    return false
  })
}

/** Read the language option from DefElem options. */
function language(options: readonly unknown[] | undefined): string | undefined {
  for (const option of options ?? []) {
    if (kindOf(option) !== 'DefElem') continue
    const value = bodyOf<{ arg?: unknown, defname?: string }>(option)
    if (value.defname === 'language' && value.arg) {
      const arg = bodyOf<{ sval?: string }>(value.arg)
      return arg.sval
    }
  }
  return undefined
}

export const sqlTemplateValidity: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression): void {
        if (!isSqlTag(node.tag)) return
        const { sql } = extractSqlTemplate(node, context)
        if (sql.trim() === '') return
        try {
          const parsed = parseSync(sql)
          if (hasPlPgSql(parsed.stmts.map(statement => statement.stmt))) parsePlPgSQLSync(sql)
        } catch (error) {
          context.report({
            data: { reason: error instanceof Error ? error.message : String(error) },
            messageId: 'invalidSql',
            node,
          })
        }
      },
    }
  },
  meta: {
    docs: {
      description: 'Require recognized SQL tagged templates to parse as PostgreSQL.',
    },
    messages: {
      invalidSql: 'SQL template is invalid: {{reason}}',
    },
    schema: [],
    type: 'problem',
  },
}
