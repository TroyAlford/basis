import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { loadModule, parseSync } from 'libpg-query'
import { extractSqlTemplate, isSqlTag } from './sql/template'

await loadModule()

/** Report SQL templates that the PostgreSQL parser cannot parse. */
export const sqlTemplateValidity: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression): void {
        if (!isSqlTag(node.tag)) return
        const { sql } = extractSqlTemplate(node, context)
        if (sql.trim() === '') return
        try {
          parseSync(sql)
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
