import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { formatSQL } from './sql/format'
import { extractSqlTemplate, isSqlTag, restoreInterpolations } from './sql/template'

/** Format recognized Bun SQL tagged templates with dprint. */
export const sqlTemplateFormat: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression): void {
        if (!isSqlTag(node.tag)) return
        const template = extractSqlTemplate(node, context)
        let formatted: string
        try {
          formatted = formatSQL(template.sql).trim()
        } catch {
          return
        }
        if (formatted === '') return
        if (template.placeholders.some(({ placeholder }) => countOccurrences(formatted, placeholder) !== 1)) return
        const lineStart = context.sourceCode.getText().lastIndexOf('\n', node.range[0]) + 1
        const baseIndent = context.sourceCode.text.slice(lineStart).match(/^\s*/u)?.[0] ?? ''
        const indented = formatted.split('\n').map(line => `${baseIndent}  ${line}`).join('\n')
        const body = restoreInterpolations(indented, template.placeholders)
        const replacement = `\`\n${body}\n${baseIndent}\``
        if (replacement === context.sourceCode.getText(node.quasi)) return
        context.report({
          fix: fixer => fixer.replaceText(node.quasi, replacement),
          messageId: 'formatSql',
          node,
        })
      },
    }
  },
  meta: {
    docs: {
      description: 'Format recognized Bun SQL tagged templates with dprint.',
    },
    fixable: 'code',
    messages: {
      formatSql: 'SQL template is not in canonical format.',
    },
    schema: [],
    type: 'layout',
  },
}

/** Count non-overlapping occurrences of text. */
function countOccurrences(value: string, needle: string): number {
  let count = 0
  let index = value.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = value.indexOf(needle, index + needle.length)
  }
  return count
}

export { formatSQL } from './sql/format'
