import type { Rule } from 'eslint'
import type * as ESTree from 'estree'

/** One recognized SQL tagged template. */
export interface SqlTemplate {
  /** Placeholder/source pairs used to restore JavaScript interpolations. */
  readonly placeholders: readonly SqlPlaceholder[],
  /** Dedented SQL with collision-safe interpolation placeholders. */
  readonly sql: string,
}

/** One JavaScript interpolation and its SQL placeholder. */
export interface SqlPlaceholder {
  readonly placeholder: string,
  readonly source: string,
}

/** Whether a tag expression is a recognized SQL tag. */
export function isSqlTag(tag: ESTree.Expression): boolean {
  const generic = tag as unknown as { expression?: ESTree.Expression, type: string }
  if (generic.type === 'TSInstantiationExpression' && generic.expression) return isSqlTag(generic.expression)
  if (tag.type === 'Identifier') return tag.name === 'sql'
  if (tag.type !== 'MemberExpression' || tag.computed || tag.property.type !== 'Identifier') return false
  if (tag.property.name !== 'sql') return false
  if (tag.object.type === 'Identifier') return tag.object.name === 'db' || tag.object.name === 'database'
  if (tag.object.type !== 'MemberExpression' || tag.object.computed) return false
  return tag.object.property.type === 'Identifier' && tag.object.property.name === 'db'
}

/** Extract a dedented SQL body and exactly-preserved interpolation sources. */
export function extractSqlTemplate(
  node: ESTree.TaggedTemplateExpression,
  context: Rule.RuleContext,
): SqlTemplate {
  const sources: string[] = []
  let raw = ''
  node.quasi.quasis.forEach((quasi, index) => {
    raw += quasi.value.raw
    if (index < node.quasi.expressions.length) {
      const next = node.quasi.quasis[index + 1] as ESTree.TemplateElement
      sources.push(`\${${context.sourceCode.text.slice(quasi.range[1], next.range[0])}}`)
      raw += `\u0001${index}\u0001`
    }
  })
  const placeholders: SqlPlaceholder[] = []
  let sql = raw
  sources.forEach((source, index) => {
    let placeholder = `__basis_param_${index}__`
    while (sql.includes(placeholder) || sources.some(value => value.includes(placeholder))) {
      placeholder += '_'
    }
    placeholders.push({ placeholder, source })
    sql = sql.replace(`\u0001${index}\u0001`, placeholder)
  })
  return { placeholders, sql: dedent(sql) }
}

/** Remove the common leading indentation of a template body. */
export function dedent(raw: string): string {
  const lines = raw.split('\n')
  const first = lines.find(line => line.trim() !== '')
  const indent = first?.match(/^\s*/u)?.[0] ?? ''
  return lines.map(line => {
    if (line.trim() === '') return ''
    return line.startsWith(indent) ? line.slice(indent.length) : line
  }).join('\n')
}

/** Restore interpolation source into a formatted SQL string. */
export function restoreInterpolations(formatted: string, placeholders: readonly SqlPlaceholder[]): string {
  let result = formatted
  for (const { placeholder, source } of placeholders) result = result.replace(placeholder, source)
  return result
}
