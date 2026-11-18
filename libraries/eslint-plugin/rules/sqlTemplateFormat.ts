import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { formatSQL, formatSQLResult } from './sql/format'

/**
 * Whether a tag expression is a recognized SQL tag.
 * @param tag - Template tag expression.
 * @returns Whether the tag is `sql` or a supported database `.sql` member.
 */
function isSqlTag(tag: ESTree.Expression): boolean {
  const generic = tag as unknown as { expression?: ESTree.Expression, type: string }
  if (generic.type === 'TSInstantiationExpression' && generic.expression) {
    return isSqlTag(generic.expression)
  }
  if (tag.type === 'Identifier') return tag.name === 'sql'
  if (tag.type !== 'MemberExpression' || tag.computed || tag.property.type !== 'Identifier') return false
  if (tag.property.name !== 'sql') return false
  if (tag.object.type === 'Identifier') return tag.object.name === 'db' || tag.object.name === 'database'
  if (tag.object.type !== 'MemberExpression' || tag.object.computed) return false
  return tag.object.property.type === 'Identifier' && tag.object.property.name === 'db'
}

/**
 * Format recognized Bun SQL tagged templates through the PostgreSQL AST.
 *
 * The adapter owns JavaScript interpolation handling: it extracts each exact
 * interpolation source, replaces it with a collision-safe marker, dedents the
 * template, formats the SQL, restores every interpolation byte-for-byte, and
 * only reports a fixable diagnostic when the formatter returned verified SQL.
 */
export const sqlTemplateFormat: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression): void {
        if (!isSqlTag(node.tag)) return
        const interpolations: string[] = []
        let raw = ''
        node.quasi.quasis.forEach((quasi, index) => {
          raw += quasi.value.raw
          if (index < node.quasi.expressions.length) {
            const next = node.quasi.quasis[index + 1] as ESTree.TemplateElement
            interpolations.push(`\${${context.sourceCode.text.slice(quasi.range[1], next.range[0])}}`)
            raw += `\u0001${index}\u0001`
          }
        })

        const lineStart = context.sourceCode.getText().lastIndexOf('\n', node.range[0]) + 1
        const baseIndent = context.sourceCode.text.slice(lineStart).match(/^\s*/u)?.[0] ?? ''
        const dedented = dedent(raw)
        const result = formatSQLResult(dedented)

        if (result.status === 'unsupported') {
          context.report({
            data: { construct: result.construct },
            messageId: 'unsupportedSql',
            node,
          })
          return
        }
        if (result.status === 'invalid') {
          context.report({
            data: { reason: result.reason },
            messageId: 'invalidSql',
            node,
          })
          return
        }

        let formatted = result.sql.split('\n').map(line => `${baseIndent}  ${line}`).join('\n')
        for (let index = 0; index < interpolations.length; index += 1) {
          const marker = `\u0001${index}\u0001`
          if (!formatted.includes(marker)) {
            context.report({ data: { reason: 'interpolation marker was lost' }, messageId: 'invalidSql', node })
            return
          }
          formatted = formatted.replace(marker, interpolations[index] as string)
        }
        if (formatted.trim() === '') return
        const body = `\n${formatted}\n${baseIndent}`
        const replacement = `\`${body}\``
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
      description: 'Require canonical formatting for Bun SQL tagged templates.',
    },
    fixable: 'code',
    messages: {
      formatSql: 'SQL template is not in canonical format.',
      invalidSql: 'SQL template could not be formatted safely: {{reason}}',
      unsupportedSql: 'Unsupported SQL syntax: {{construct}}',
    },
    schema: [],
    type: 'layout',
  },
}

/**
 * Remove the common leading indentation of a template body.
 * @param raw - Raw template body.
 * @returns Dedented template body.
 */
function dedent(raw: string): string {
  const lines = raw.split('\n')
  const first = lines.find(line => line.trim() !== '')
  const indent = first?.match(/^\s*/u)?.[0] ?? ''
  return lines.map(line => {
    if (line.trim() === '') return ''
    return line.startsWith(indent) ? line.slice(indent.length) : line
  }).join('\n')
}

export { formatSQL, formatSQLResult }
export type { SqlFormatResult } from './sql/format'
