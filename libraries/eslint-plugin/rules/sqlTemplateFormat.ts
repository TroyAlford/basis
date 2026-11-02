import type { Rule } from 'eslint'
import type * as ESTree from 'estree'

/** Major clauses that begin their own SQL line. */
const CLAUSES = [
  'left outer join', 'right outer join', 'full outer join',
  'group by', 'order by', 'insert into', 'delete from',
  'select', 'from', 'where', 'join', 'left join', 'right join', 'inner join',
  'set', 'values', 'having', 'limit', 'offset', 'returning', 'update', 'with',
]
/** SQL keywords normalized to lowercase outside literals and identifiers. */
const KEYWORDS = new Set([
  'add', 'all', 'alter', 'and', 'as', 'asc', 'begin', 'between', 'by', 'case',
  'check', 'constraint', 'create', 'deferrable', 'delete', 'desc', 'distinct',
  'drop', 'else', 'end', 'exists', 'false', 'for', 'foreign', 'from', 'gin',
  'group', 'having', 'if', 'in', 'index', 'initially', 'insert', 'into', 'is',
  'join', 'key', 'left', 'limit', 'not', 'null', 'offset', 'on', 'or', 'order',
  'outer', 'primary', 'references', 'returning', 'right', 'select', 'set',
  'table', 'then', 'true', 'union', 'unique', 'update', 'using', 'values',
  'when', 'where', 'with',
])

/**
 * Whether a template tag is a known Bun SQL tag.
 * @param tag - Template tag.
 * @returns `true` for recognized SQL tags.
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
 * Format one SQL template body.
 * @param sql - SQL text with expression placeholders.
 * @returns Formatted SQL text.
 */
export function formatSQL(sql: string): string {
  const normalized = normalizeSQL(sql).replace(/;\s*$/u, '').trim()
  const withClauses = addClauseBreaks(normalized)
  return withClauses
    .split('\n')
    .flatMap(line => (line.trim() === '' ? [] : wrapLine(line.trim())))
    .join('\n')
}

/**
 * Wrap a long SQL line at commas or spaces.
 * @param line - One SQL line.
 * @returns Wrapped lines.
 */
function wrapLine(line: string): readonly string[] {
  if (line.length <= 100) return [line]
  const parts = splitOutside(line, ',').map(part => part.trim()).filter(part => part !== '')
  if (parts.length > 1) {
    return parts.map((part, index) => `${index === 0 ? '' : '  '}${part}${index < parts.length - 1 ? ',' : ''}`)
  }
  const words = splitOutside(line, ' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current === '' ? word : `${current} ${word}`
    if (next.length > 100 && current !== '') {
      lines.push(current)
      current = word
    } else current = next
  }
  if (current !== '') lines.push(current)
  return lines.map((part, index) => `${index === 0 ? '' : '  '}${part}`)
}

/**
 * Lowercase SQL keywords and normalize whitespace outside quoted regions.
 * @param sql - SQL text.
 * @returns Normalized text.
 */
function normalizeSQL(sql: string): string {
  let result = ''
  let index = 0
  let pendingSpace = false
  while (index < sql.length) {
    const character = sql[index] as string
    if (character === "'" || character === '"') {
      const quote = character
      result += separator(result, pendingSpace)
      pendingSpace = false
      result += quote
      index += 1
      while (index < sql.length) {
        const next = sql[index] as string
        result += next
        index += 1
        if (next === quote) {
          if (sql[index] === quote) {
            result += quote
            index += 1
          } else break
        }
      }
      continue
    }
    if (character === '-' && sql[index + 1] === '-') {
      const end = sql.indexOf('\n', index)
      result += separator(result, pendingSpace)
      pendingSpace = false
      result += end === -1 ? sql.slice(index) : sql.slice(index, end)
      index = end === -1 ? sql.length : end
      continue
    }
    if (character === '/' && sql[index + 1] === '*') {
      const end = sql.indexOf('*/', index + 2)
      result += separator(result, pendingSpace)
      pendingSpace = false
      result += end === -1 ? sql.slice(index) : sql.slice(index, end + 2)
      index = end === -1 ? sql.length : end + 2
      continue
    }
    if (character === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(sql.slice(index))?.[0]
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length)
        result += separator(result, pendingSpace)
        pendingSpace = false
        result += end === -1 ? sql.slice(index) : sql.slice(index, end + tag.length)
        index = end === -1 ? sql.length : end + tag.length
        continue
      }
    }
    if (/\s/u.test(character)) {
      pendingSpace = result.length > 0
      index += 1
      continue
    }
    if (/[A-Za-z_]/u.test(character)) {
      let end = index + 1
      while (end < sql.length && /[A-Za-z0-9_]/u.test(sql[end] as string)) end += 1
      const word = sql.slice(index, end)
      result += separator(result, pendingSpace)
      pendingSpace = false
      result += KEYWORDS.has(word.toLowerCase()) ? word.toLowerCase() : word
      index = end
      continue
    }
    if (character === ',' || character === ')' || character === ';') {
      result = result.trimEnd()
    }
    result += separator(result, pendingSpace)
    pendingSpace = false
    result += character
    index += 1
  }
  return result
}

/**
 * Insert newlines before top-level major clauses.
 * @param sql - Normalized SQL.
 * @returns SQL with clause lines.
 */
function addClauseBreaks(sql: string): string {
  let result = ''
  let index = 0
  let depth = 0
  while (index < sql.length) {
    const character = sql[index] as string
    if (character === "'" || character === '"') {
      const quote = character
      const start = index
      index += 1
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) index += 2
          else { index += 1; break }
        } else index += 1
      }
      result += sql.slice(start, index)
      continue
    }
    if (character === '(') depth += 1
    if (character === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && (index === 0 || /\s/u.test(sql[index - 1] as string))) {
      const match = CLAUSES.find(clause => sql.slice(index, index + clause.length).toLowerCase() === clause
        && !/[A-Za-z0-9_]/u.test(sql[index + clause.length] ?? ''))
      if (match) {
        if (result.trim() !== '' && !result.endsWith('\n')) result = result.trimEnd() + '\n'
        result += match
        index += match.length
        continue
      }
    }
    result += character
    index += 1
  }
  return result
}

/**
 * Split SQL text on a delimiter outside quoted strings, identifiers,
 * dollar-quoted bodies and comments.
 * @param value - SQL text.
 * @param delimiter - Character delimiter.
 * @returns Text segments without the delimiter.
 */
function splitOutside(value: string, delimiter: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let dollar: string | null = null
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string
    if (quote) {
      current += character
      if (character === quote) {
        if (value[index + 1] === quote) {
          current += quote
          index += 1
        } else quote = null
      }
      continue
    }
    if (dollar) {
      current += character
      if (value.startsWith(dollar, index)) {
        current += dollar.slice(1)
        index += dollar.length - 1
        dollar = null
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      current += character
      continue
    }
    if (character === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(value.slice(index))?.[0]
      if (tag) {
        dollar = tag
        current += tag
        index += tag.length - 1
        continue
      }
    }
    if (character === delimiter) {
      if (delimiter === ' ') {
        if (current.trim() !== '') parts.push(current.trim())
        current = ''
      } else {
        parts.push(current)
        current = ''
      }
      continue
    }
    current += character
  }
  if (current.trim() !== '') parts.push(delimiter === ' ' ? current.trim() : current)
  return parts
}

/**
 * Return a separator when whitespace is pending.
 * @param current - Current SQL.
 * @param pending - Whether whitespace is pending.
 * @returns Single space or empty.
 */
function separator(current: string, pending: boolean): string {
  if (!pending) return ''
  const previous = current.at(-1)
  if (!previous || previous === '(' || previous === '\n') return ''
  return ' '
}

export const sqlTemplateFormat: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression): void {
        if (!isSqlTag(node.tag)) return
        const placeholders: string[] = []
        let raw = ''
        node.quasi.quasis.forEach((quasi, index) => {
          raw += quasi.value.raw
          if (index < node.quasi.expressions.length) {
            const placeholder = `\u0001${index}\u0001`
            placeholders.push(placeholder)
            raw += placeholder
          }
        })
        const formatted = formatSQL(raw)
        const lineStart = context.sourceCode.getText().lastIndexOf('\n', node.range[0]) + 1
        const baseIndent = context.sourceCode.text.slice(lineStart).match(/^\s*/u)?.[0] ?? ''
        const indent = `${baseIndent}  `
        const lines = formatted.split('\n').map(line => (
          /^(?:and|or)\b/iu.test(line) ? `${indent}  ${line}` : `${indent}${line}`
        ))
        let body = `\n${lines.join('\n')}\n${baseIndent}`
        placeholders.forEach((placeholder, index) => {
          const expression = context.sourceCode.getText(
            node.quasi.expressions[index] as ESTree.Expression,
          )
          body = body.replace(placeholder, `\${${expression}}`)
        })
        body = body
          .split('\n')
          .flatMap(line => (line.length <= 100 ? [line] : wrapLine(line)))
          .join('\n')
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
    },
    schema: [],
    type: 'layout',
  },
}
