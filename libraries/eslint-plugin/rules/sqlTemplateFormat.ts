import type { Rule } from 'eslint'
import type * as ESTree from 'estree'

/** Token kinds produced by the SQL tokenizer. */
type TokenKind =
  | 'block-comment'
  | 'dollar'
  | 'line-comment'
  | 'number'
  | 'operator'
  | 'placeholder'
  | 'punctuation'
  | 'quoted'
  | 'string'
  | 'word'

/** One lexical SQL token. */
interface Token {
  kind: TokenKind,
  ownLine?: boolean,
  text: string,
  upper: string,
}

/** SQL and PL/pgSQL keywords normalized to uppercase outside literals. */
const KEYWORDS = new Set([
  'add', 'all', 'alter', 'and', 'as', 'asc', 'begin', 'between', 'by', 'case',
  'check', 'column', 'constraint', 'create', 'declare', 'default', 'deferrable',
  'delete', 'desc', 'distinct', 'do', 'drop', 'else', 'elsif', 'end', 'exception',
  'execute', 'exists', 'for', 'foreign', 'from', 'function', 'gin', 'group',
  'having', 'if', 'in', 'index', 'initially', 'insert', 'into', 'is', 'join',
  'key', 'language', 'left', 'limit', 'loop', 'new', 'not', 'notice', 'null',
  'offset', 'old', 'on', 'or', 'order', 'outer', 'perform',
  'precision', 'primary', 'raise', 'recursive', 'references', 'replace', 'return',
  'rename', 'returning', 'returns', 'right', 'select', 'set', 'table', 'then',
  'to', 'trigger', 'union', 'unique', 'update', 'using', 'values', 'view',
  'when', 'where', 'while', 'with',
  'abs', 'array_length', 'array_position', 'array_remove', 'array_to_string',
  'avg', 'cast', 'coalesce', 'count', 'extract', 'jsonb_agg',
  'jsonb_build_object', 'length', 'lower', 'max', 'min', 'now', 'round',
  'setweight', 'string_to_array', 'sum', 'to_tsvector', 'trim', 'unaccent',
  'upper',
])

/** SQL type names normalized to uppercase inside column definitions. */
const TYPE_WORDS = new Set([
  'bigint', 'boolean', 'character', 'date', 'double', 'integer', 'jsonb',
  'numeric', 'precision', 'real', 'serial', 'smallint', 'text', 'time',
  'timestamp', 'uuid', 'varchar', 'varying', 'zone',
])

/** Keywords that keep a space before an opening parenthesis. */
const SPACE_BEFORE_PAREN = new Set([
  'as', 'exists', 'in', 'on', 'table', 'then', 'using', 'values', 'view',
])

/** Multi-word clause openings, longest first. */
const CLAUSE_PHRASES: readonly (readonly string[])[] = [
  ['full', 'outer', 'join'],
  ['left', 'outer', 'join'],
  ['right', 'outer', 'join'],
  ['delete', 'from'],
  ['insert', 'into'],
  ['group', 'by'],
  ['order', 'by'],
  ['union', 'all'],
  ['inner', 'join'],
  ['left', 'join'],
  ['right', 'join'],
  ['select'],
  ['from'],
  ['where'],
  ['having'],
  ['limit'],
  ['offset'],
  ['returning'],
  ['join'],
  ['set'],
  ['values'],
  ['update'],
  ['with'],
  ['union'],
]

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
 * Split SQL text into tokens while preserving literals, comments, and dollar bodies.
 * @param sql - SQL text.
 * @returns Tokens in source order.
 */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < sql.length) {
    const character = sql[index] as string
    if (/\s/u.test(character)) {
      index += 1
      continue
    }
    if (character === '-' && sql[index + 1] === '-') {
      const end = sql.indexOf('\n', index)
      const stop = end === -1 ? sql.length : end
      const lineStart = sql.lastIndexOf('\n', index) + 1
      const comment = token('line-comment', sql.slice(index, stop))
      comment.ownLine = /^\s*$/u.test(sql.slice(lineStart, index))
      tokens.push(comment)
      index = stop
      continue
    }
    if (character === '/' && sql[index + 1] === '*') {
      const end = sql.indexOf('*/', index + 2)
      const stop = end === -1 ? sql.length : end + 2
      tokens.push(token('block-comment', sql.slice(index, stop)))
      index = stop
      continue
    }
    if (character === "'" || character === '"') {
      const start = index
      index += 1
      while (index < sql.length) {
        if (sql[index] === character) {
          if (sql[index + 1] === character) {
            index += 2
          } else {
            index += 1
            break
          }
        } else {
          index += 1
        }
      }
      tokens.push(token(character === "'" ? 'string' : 'quoted', sql.slice(start, index)))
      continue
    }
    if (character === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(sql.slice(index))?.[0]
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length)
        const stop = end === -1 ? sql.length : end + tag.length
        tokens.push(token('dollar', sql.slice(index, stop)))
        index = stop
        continue
      }
      const parameter = /^\$\d+/u.exec(sql.slice(index))?.[0]
      if (parameter) {
        tokens.push(token('placeholder', parameter))
        index += parameter.length
        continue
      }
    }
    if (character === '\u0001') {
      let end = index + 1
      while (/\d/u.test(sql[end] ?? '')) end += 1
      if (sql[end] === '\u0001') {
        end += 1
        while (sql[end] === '\u0002') end += 1
        tokens.push(token('placeholder', sql.slice(index, end)))
        index = end
        continue
      }
    }
    if ('(),;[]'.includes(character)) {
      tokens.push(token('punctuation', character))
      index += 1
      continue
    }
    const operator = [
      ':=', '::', '||', '>=', '<=', '<>', '!=', '->>', '->', '=<', '@>', '<@', '@?', '@@', '#>>', '#>',
      '=', '<', '>', '+', '-', '*', '/', '.',
    ].find(candidate => sql.startsWith(candidate, index))
    if (operator) {
      tokens.push(token('operator', operator))
      index += operator.length
      continue
    }
    if (/[0-9]/u.test(character)) {
      const match = /^\d+(?:\.\d+)?/u.exec(sql.slice(index))
      if (match) {
        tokens.push(token('number', match[0]))
        index += match[0].length
        continue
      }
    }
    if (/[A-Za-z_]/u.test(character)) {
      const match = /^[A-Za-z_][A-Za-z0-9_$]*/u.exec(sql.slice(index))
      if (match) {
        tokens.push(token('word', match[0]))
        index += match[0].length
        continue
      }
    }
    tokens.push(token('operator', character))
    index += 1
  }
  return tokens
}

/**
 * Build one token with its uppercase keyword form.
 * @param kind - Token kind.
 * @param text - Token text.
 * @returns Token.
 */
function token(kind: TokenKind, text: string): Token {
  return { kind, text, upper: kind === 'word' ? text.toLowerCase() : text }
}

/**
 * Format one SQL template body.
 * @param sql - SQL text with expression placeholders.
 * @param indent - Prefix for every formatted line.
 * @returns Formatted SQL text.
 */
export function formatSQL(sql: string, indent = ''): string {
  const statements = splitStatements(tokenize(sql))
  if (statements.length === 0) return ''
  const blocks = statements.map(statement => wrapLongLines(formatStatement(statement, indent)))
  const lines: string[] = []
  blocks.forEach((block, index) => {
    if (index < blocks.length - 1 && block.length > 0) {
      const last = block[block.length - 1] as string
      if (!last.endsWith(';')) block[block.length - 1] = `${last};`
    }
    if (index > 0) lines.push('')
    lines.push(...block)
  })
  return lines.join('\n')
}

/**
 * Wrap formatted lines longer than the preferred width at safe SQL boundaries.
 * @param lines - Formatted lines.
 * @param width - Preferred maximum line width.
 * @returns Wrapped lines.
 */
function wrapLongLines(lines: readonly string[], width = 100): string[] {
  return lines.flatMap(line => line.split('\n')).flatMap(line => {
    if (line.length <= width || line.trimStart().startsWith('--')) return [line]
    const indent = line.match(/^\s*/u)?.[0] ?? ''
    const result: string[] = []
    let current = line
    let guard = 0
    while (current.length > width && guard < line.length) {
      const breakAt = safeBreak(current, width)
      if (breakAt <= indent.length) break
      result.push(current.slice(0, breakAt).trimEnd())
      current = `${indent}  ${current.slice(breakAt).trimStart()}`
      guard += 1
    }
    result.push(current)
    return result
  })
}

/**
 * Find the last safe SQL break at or before a width.
 * @param line - SQL line.
 * @param width - Preferred maximum width.
 * @returns Break offset, or -1 when no safe break exists.
 */
function safeBreak(line: string, width: number): number {
  let quote: "'" | '"' | null = null
  let lastComma = -1
  let lastSpace = -1
  for (let index = 0; index < line.length && index <= width; index += 1) {
    const character = line[index] as string
    if (quote) {
      if (character === quote) {
        if (line[index + 1] === quote) index += 1
        else quote = null
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character === '-' && line[index + 1] === '-') break
    if (character === '/' && line[index + 1] === '*') {
      const end = line.indexOf('*/', index + 2)
      if (end === -1) break
      index = end + 1
      continue
    }
    if (character === ',') lastComma = index + 1
    if (/\s/u.test(character)) lastSpace = index
  }
  return lastComma > 0 ? lastComma : lastSpace
}

/**
 * Split tokens into statements on top-level semicolons.
 * @param tokens - Statement tokens.
 * @returns Statement token lists.
 */
function splitStatements(tokens: readonly Token[]): Token[][] {
  const statements: Token[][] = []
  let current: Token[] = []
  let depth = 0
  for (const candidate of tokens) {
    if (candidate.text === '(') depth += 1
    if (candidate.text === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && candidate.text === ';') {
      if (current.length > 0) statements.push(current)
      current = []
      continue
    }
    current.push(candidate)
  }
  if (current.length > 0) statements.push(current)
  return statements
}

/**
 * Format one SQL statement.
 * @param tokens - Statement tokens.
 * @param indent - Prefix for this block.
 * @returns Formatted lines.
 */
function formatStatement(tokens: readonly Token[], indent: string): string[] {
  const dollarIndex = tokens.findIndex(candidate => candidate.kind === 'dollar')
  if (startsWith(tokens, ['create', 'view'])) return formatCreateView(tokens, indent)
  if (startsWith(tokens, ['create', 'table'])) return formatCreateTable(tokens, indent)
  if (startsWith(tokens, ['create']) && dollarIndex !== -1) return formatFunction(tokens, dollarIndex, indent)
  if (startsWith(tokens, ['do']) && dollarIndex !== -1) return formatDo(tokens, dollarIndex, indent)
  if (startsWith(tokens, ['with'])) return formatWith(tokens, indent)
  return formatQuery(tokens, indent)
}

/**
 * Format a `CREATE VIEW` statement.
 * @param tokens - Statement tokens.
 * @param indent - Prefix for this block.
 * @returns Formatted lines.
 */
function formatCreateView(tokens: readonly Token[], indent: string): string[] {
  const asIndex = findTopLevel(tokens, candidate => candidate.upper === 'as')
  if (asIndex === -1) return formatQuery(tokens, indent)
  const header = formatInline(tokens.slice(0, asIndex + 1))
  const open = asIndex + 1
  const alreadyWrapped = tokens[open]?.text === '(' && matchingParen(tokens, open) === tokens.length - 1
  const body = alreadyWrapped
    ? formatQuery(tokens.slice(open + 1, tokens.length - 1), `${indent}  `)
    : formatQuery(tokens.slice(open), `${indent}  `)
  return [`${indent}${header} (`, ...body, `${indent})`]
}

/**
 * Whether a SELECT list should be rendered one expression per line.
 * @param tokens - Statement tokens.
 * @param start - First token after SELECT.
 * @returns `true` for CASE or long select lists.
 */
function shouldMultilineSelect(tokens: readonly Token[], start: number): boolean {
  let depth = 0
  let end = tokens.length
  for (let index = start; index < tokens.length; index += 1) {
    const currentToken = tokens[index] as Token
    if (currentToken.text === '(') depth += 1
    if (currentToken.text === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && clauseAt(tokens, index)) {
      end = index
      break
    }
    if (depth === 0 && currentToken.upper === 'case') return true
    if (depth === 0 && currentToken.kind === 'line-comment') return true
  }
  return formatInline(tokens.slice(start, end)).length > 100
}

/**
 * Format one select-list expression, breaking long function calls.
 * @param tokens - Expression tokens.
 * @param indent - Prefix for this expression.
 * @returns Formatted lines.
 */
function formatExpression(tokens: readonly Token[], indent: string): string[] {
  const asIndex = findTopLevel(tokens, candidate => candidate.upper === 'as')
  const expression = asIndex === -1 ? tokens : tokens.slice(0, asIndex)
  const alias = asIndex === -1 ? '' : ` AS ${formatInline(tokens.slice(asIndex + 1))}`
  const inline = `${formatInline(expression)}${alias}`
  if (`${indent}${inline}`.length <= 80) return [`${indent}${inline}`]

  const chains = splitOperator(expression, '||')
  if (chains.length > 1) {
    const lines = chains.map(chain => `${indent}${formatInline(chain)}`)
    lines[lines.length - 1] = `${lines[lines.length - 1]}${alias}`
    return lines
  }

  const open = expression[1]?.text === '(' ? 1 : -1
  if (open === -1 || expression[0]?.kind !== 'word') return [`${indent}${inline}`]
  const close = matchingParen(expression, open)
  if (close !== expression.length - 1) return [`${indent}${inline}`]

  const name = formatInline(expression.slice(0, 1))
  const args = splitList(expression.slice(open + 1, close))
  const lines = [`${indent}${name}(`]
  args.forEach((argument, index) => {
    const formatted = formatExpression(argument, `${indent}  `)
    if (index < args.length - 1 && formatted.length > 0) {
      formatted[formatted.length - 1] = `${formatted[formatted.length - 1]},`
    }
    lines.push(...formatted)
  })
  lines.push(`${indent})${alias}`)
  return lines
}

/**
 * Split tokens on one top-level binary operator.
 * @param tokens - Expression tokens.
 * @param operator - Binary operator text.
 * @returns Token groups; later groups keep the operator prefix.
 */
function splitOperator(tokens: readonly Token[], operator: string): Token[][] {
  const groups: Token[][] = []
  let current: Token[] = []
  let depth = 0
  for (const candidate of tokens) {
    if (candidate.text === '(') depth += 1
    if (candidate.text === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && candidate.text === operator) {
      groups.push(current)
      current = [candidate]
      continue
    }
    current.push(candidate)
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/**
 * Find the matching closing parenthesis.
 * @param tokens - Token list.
 * @param open - Opening parenthesis index.
 * @returns Closing parenthesis index, or -1.
 */
function matchingParen(tokens: readonly Token[], open: number): number {
  let depth = 0
  for (let index = open; index < tokens.length; index += 1) {
    if (tokens[index]?.text === '(') depth += 1
    if (tokens[index]?.text === ')') depth -= 1
    if (depth === 0) return index
  }
  return -1
}

/**
 * Format one CASE expression and its optional alias/comma.
 * @param tokens - Statement tokens.
 * @param start - CASE token index.
 * @param indent - Prefix for the CASE block.
 * @returns Formatted lines and the next token index.
 */
function formatCase(tokens: readonly Token[], start: number, indent: string): { lines: string[], nextIndex: number } {
  const segments: Token[][] = []
  let segment: Token[] = []
  let depth = 0
  let nested = 0
  let end = tokens.length - 1
  for (let index = start + 1; index < tokens.length; index += 1) {
    const currentToken = tokens[index] as Token
    if (currentToken.text === '(') depth += 1
    if (currentToken.text === ')') depth = Math.max(0, depth - 1)
    if (currentToken.upper === 'case') nested += 1
    if (currentToken.upper === 'end') {
      if (nested > 0) {
        nested -= 1
        segment.push(currentToken)
        continue
      }
      end = index
      break
    }
    if (depth === 0 && nested === 0 && (currentToken.upper === 'when' || currentToken.upper === 'else')) {
      if (segment.length > 0) segments.push(segment)
      segment = [currentToken]
      continue
    }
    segment.push(currentToken)
  }
  if (segment.length > 0) segments.push(segment)

  const lines = [`${indent}CASE`]
  for (const part of segments) {
    const first = part[0]
    if (!first) continue
    if (first.upper === 'when') {
      let thenIndex = -1
      let partDepth = 0
      for (let index = 1; index < part.length; index += 1) {
        const currentToken = part[index] as Token
        if (currentToken.text === '(') partDepth += 1
        if (currentToken.text === ')') partDepth -= 1
        if (partDepth === 0 && currentToken.upper === 'then') {
          thenIndex = index
          break
        }
      }
      const condition = part.slice(1, thenIndex === -1 ? part.length : thenIndex)
      const result = thenIndex === -1 ? [] : part.slice(thenIndex + 1)
      lines.push(`${indent}  WHEN ${formatInline(condition)}${thenIndex === -1 ? '' : ` THEN ${formatInline(result)}`}`)
    } else if (first.upper === 'else') {
      lines.push(`${indent}  ELSE ${formatInline(part.slice(1))}`)
    }
  }
  lines.push(`${indent}END`)

  let nextIndex = end + 1
  if (tokens[nextIndex]?.upper === 'as' && tokens[nextIndex + 1]) {
    lines[lines.length - 1] = `${lines[lines.length - 1]} AS ${tokens[nextIndex + 1]?.text}`
    nextIndex += 2
  }
  if (tokens[nextIndex]?.text === ',') {
    lines[lines.length - 1] = `${lines[lines.length - 1]},`
    nextIndex += 1
  }
  return { lines, nextIndex }
}

/**
 * Format a CREATE FUNCTION statement with a dollar-quoted PL/pgSQL body.
 * @param tokens - Statement tokens.
 * @param dollarIndex - Index of the dollar-quoted body token.
 * @param indent - Prefix for this block.
 * @returns Formatted lines.
 */
function formatFunction(tokens: readonly Token[], dollarIndex: number, indent: string): string[] {
  const header = formatInline(tokens.slice(0, dollarIndex))
  const dollar = tokens[dollarIndex] as Token
  const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(dollar.text)?.[0] ?? '$$'
  const body = dollar.text.slice(tag.length, dollar.text.length - tag.length)
  const closing = formatInline(tokens.slice(dollarIndex + 1))
  return [
    `${indent}${header} ${tag}`,
    ...formatPlpgsql(tokenize(body), indent),
    `${indent}${tag}${closing === '' ? '' : ` ${closing}`};`,
  ]
}

/**
 * Format a standalone DO block with a dollar-quoted PL/pgSQL body.
 * @param tokens - Statement tokens.
 * @param dollarIndex - Index of the dollar-quoted body token.
 * @param indent - Prefix for this block.
 * @returns Formatted lines.
 */
function formatDo(tokens: readonly Token[], dollarIndex: number, indent: string): string[] {
  const header = formatInline(tokens.slice(0, dollarIndex))
  const dollar = tokens[dollarIndex] as Token
  const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(dollar.text)?.[0] ?? '$$'
  const body = dollar.text.slice(tag.length, dollar.text.length - tag.length)
  return [`${indent}${header} ${tag}`, ...formatPlpgsql(tokenize(body), indent), `${indent}${tag}`]
}

/**
 * Format a PL/pgSQL body.
 * @param tokens - Body tokens.
 * @param indent - Prefix for the block.
 * @returns Formatted lines.
 */
function formatPlpgsql(tokens: readonly Token[], indent: string): string[] {
  const lines: string[] = []
  let index = 0
  if (tokens[index]?.upper === 'declare') {
    lines.push(`${indent}DECLARE`)
    const declarations = formatBlock(tokens, index + 1, `${indent}  `, new Set(['begin']), formatColumn)
    lines.push(...declarations.lines)
    index = declarations.next
  }
  if (tokens[index]?.upper === 'begin') index += 1
  lines.push(`${indent}BEGIN`)
  const body = formatBlock(tokens, index, `${indent}  `, new Set(['end', 'exception']))
  lines.push(...body.lines)
  index = body.next
  if (tokens[index]?.upper === 'exception') {
    lines.push(`${indent}EXCEPTION`)
    index += 1
    while (index < tokens.length && tokens[index]?.upper !== 'end') {
      if (tokens[index]?.upper === 'when') {
        const thenIndex = findTopLevel(tokens.slice(index + 1), candidate => candidate.upper === 'then') + index + 1
        lines.push(`${indent}  WHEN ${formatInline(tokens.slice(index + 1, thenIndex))} THEN`)
        index = thenIndex + 1
        const handler = formatBlock(tokens, index, `${indent}    `, new Set(['when', 'end']))
        lines.push(...handler.lines)
        index = handler.next
      } else {
        index += 1
      }
    }
  }
  if (tokens[index]?.upper === 'end') {
    lines.push(`${indent}END`)
  }
  return lines
}

/**
 * Format a sequence of PL/pgSQL statements until a stop keyword.
 * @param tokens - Body tokens.
 * @param start - First token index.
 * @param indent - Prefix for statements.
 * @param stop - Keywords that end this block.
 * @param format - Statement formatter.
 * @returns Formatted lines and the next token index.
 */
function formatBlock(
  tokens: readonly Token[],
  start: number,
  indent: string,
  stop: ReadonlySet<string>,
  format: (tokens: readonly Token[]) => string = formatInline,
): { lines: string[], next: number } {
  const lines: string[] = []
  let index = start
  while (index < tokens.length) {
    const currentToken = tokens[index] as Token
    if (currentToken.kind === 'word' && stop.has(currentToken.upper)) break
    if (currentToken.kind === 'line-comment' && currentToken.ownLine) {
      lines.push(`${indent}${currentToken.text}`)
      index += 1
      continue
    }
    if (currentToken.upper === 'if') {
      const result = formatIf(tokens, index, indent)
      lines.push(...result.lines)
      index = result.next
      continue
    }
    if (currentToken.upper === 'return' && /END (?:IF|LOOP);$/u.test(lines[lines.length - 1] ?? '')) {
      lines.push('')
    }
    let end = index
    let depth = 0
    while (end < tokens.length) {
      const candidate = tokens[end] as Token
      if (candidate.text === '(') depth += 1
      if (candidate.text === ')') depth = Math.max(0, depth - 1)
      if (depth === 0 && candidate.kind === 'word' && stop.has(candidate.upper)) break
      if (depth === 0 && candidate.text === ';') {
        end += 1
        break
      }
      end += 1
    }
    const statement = tokens.slice(index, end)
    const semicolon = statement[statement.length - 1]?.text === ';'
    const text = semicolon ? statement.slice(0, -1) : statement
    if (text.length > 0) {
      const inline = `${indent}${format(text)}${semicolon ? ';' : ''}`
      if (text[0]?.upper === 'return' && text.length > 1 && inline.length > 100) {
        lines.push(`${indent}RETURN`)
        const expression = formatExpression(text.slice(1), `${indent}  `)
        if (semicolon && expression.length > 0) {
          expression[expression.length - 1] = `${expression[expression.length - 1]};`
        }
        lines.push(...expression)
      } else {
        lines.push(inline)
      }
    }
    index = end
  }
  return { lines, next: index }
}

/**
 * Format one PL/pgSQL IF/ELSIF/ELSE block.
 * @param tokens - Body tokens.
 * @param start - IF token index.
 * @param indent - Prefix for the IF block.
 * @returns Formatted lines and the next token index.
 */
function formatIf(tokens: readonly Token[], start: number, indent: string): { lines: string[], next: number } {
  const lines: string[] = []
  const thenIndex = findTopLevel(tokens.slice(start + 1), candidate => candidate.upper === 'then') + start + 1
  lines.push(`${indent}IF ${formatInline(tokens.slice(start + 1, thenIndex))} THEN`)
  let index = thenIndex + 1
  while (index < tokens.length) {
    const body = formatBlock(tokens, index, `${indent}  `, new Set(['elsif', 'else', 'end']))
    lines.push(...body.lines)
    index = body.next
    if (tokens[index]?.upper === 'elsif') {
      const nextThen = findTopLevel(tokens.slice(index + 1), candidate => candidate.upper === 'then') + index + 1
      lines.push(`${indent}ELSIF ${formatInline(tokens.slice(index + 1, nextThen))} THEN`)
      index = nextThen + 1
      continue
    }
    if (tokens[index]?.upper === 'else') {
      lines.push(`${indent}ELSE`)
      index += 1
      continue
    }
    if (tokens[index]?.upper === 'end' && tokens[index + 1]?.upper === 'if') {
      lines.push(`${indent}END IF;`)
      index += 2
      if (tokens[index]?.text === ';') index += 1
      break
    }
    break
  }
  return { lines, next: index }
}

/**
 * Format a `WITH` query containing one or more CTEs.
 * @param tokens - Statement tokens.
 * @param indent - Prefix for this block.
 * @returns Formatted lines.
 */
function formatWith(tokens: readonly Token[], indent: string): string[] {
  const lines: string[] = []
  let index = 1
  const prefix: string[] = ['WITH']
  if (tokens[index]?.upper === 'recursive') {
    prefix.push('RECURSIVE')
    index += 1
  }

  while (index < tokens.length) {
    const asIndex = findTopLevel(tokens.slice(index), candidate => candidate.upper === 'as') + index
    if (asIndex < index) break
    const name = formatInline(tokens.slice(index, asIndex))
    const open = asIndex + 1
    if (tokens[open]?.text !== '(') break
    let depth = 0
    let close = -1
    for (let cursor = open; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor]?.text === '(') depth += 1
      if (tokens[cursor]?.text === ')') depth -= 1
      if (depth === 0) {
        close = cursor
        break
      }
    }
    if (close === -1) break
    lines.push(`${indent}${prefix.length > 0 ? `${prefix.join(' ')} ` : ''}${name} AS (`)
    lines.push(...formatQuery(tokens.slice(open + 1, close), `${indent}  `))
    prefix.length = 0
    const comma = tokens[close + 1]?.text === ','
    lines.push(`${indent})${comma ? ',' : ''}`)
    index = comma ? close + 2 : close + 1
    if (!comma) break
  }

  if (index < tokens.length) lines.push(...formatQuery(tokens.slice(index), indent))
  return lines
}

/**
 * Format a `CREATE TABLE` statement.
 * @param tokens - Statement tokens.
 * @param indent - Prefix for this block.
 * @returns Formatted lines.
 */
function formatCreateTable(tokens: readonly Token[], indent: string): string[] {
  const open = tokens.findIndex(candidate => candidate.text === '(')
  if (open === -1) return formatQuery(tokens, indent)
  let depth = 0
  let close = -1
  for (let index = open; index < tokens.length; index += 1) {
    if (tokens[index]?.text === '(') depth += 1
    if (tokens[index]?.text === ')') depth -= 1
    if (depth === 0) {
      close = index
      break
    }
  }
  if (close === -1) return formatQuery(tokens, indent)
  const header = formatInline(tokens.slice(0, open))
  const items = splitList(tokens.slice(open + 1, close))
  const lines = items.map(item => `${indent}  ${formatColumn(item)},`)
  if (lines.length > 0) lines[lines.length - 1] = (lines[lines.length - 1] as string).replace(/,$/u, '')
  return [`${indent}${header} (`, ...lines, `${indent})`]
}

/**
 * Format one CREATE TABLE column or constraint.
 * @param tokens - Column tokens.
 * @returns Formatted column text.
 */
function formatColumn(tokens: readonly Token[]): string {
  const upper = tokens.map((candidate, index) => (
    index > 0 && candidate.kind === 'word' && TYPE_WORDS.has(candidate.upper)
      ? { ...candidate, text: candidate.text.toUpperCase() }
      : candidate
  ))
  return formatInline(upper)
}

/**
 * Split a parenthesized token list on top-level commas.
 * @param tokens - Token list without the outer parentheses.
 * @returns Token groups.
 */
function splitList(tokens: readonly Token[]): Token[][] {
  const parts: Token[][] = []
  let current: Token[] = []
  let depth = 0
  for (const candidate of tokens) {
    if (candidate.text === '(') depth += 1
    if (candidate.text === ')') depth = Math.max(0, depth - 1)
    if (candidate.text === ',' && depth === 0) {
      parts.push(current)
      current = []
      continue
    }
    current.push(candidate)
  }
  if (current.length > 0) parts.push(current)
  return parts
}

/**
 * Format a query or DML statement.
 * @param tokens - Statement tokens.
 * @param indent - Prefix for this block.
 * @returns Formatted lines.
 */
function formatQuery(tokens: readonly Token[], indent: string): string[] {
  const lines: string[] = []
  let current = ''
  let depth = 0
  let between = false

  let selectMode = false
  let selectIndent = `${indent}  `
  let selectNeedsHeader = false
  let selectTokens: Token[] = []

  const flush = (): void => {
    if (current.trim() !== '') lines.push(`${indent}${current.trimEnd()}`)
    current = ''
  }
  const flushSelect = (comma: boolean): void => {
    if (selectTokens.length === 0) return
    const formatted = formatExpression(selectTokens, selectIndent)
    if (selectNeedsHeader) {
      selectNeedsHeader = false
      const first = formatted[0] ?? ''
      if (!comma && !first.trimEnd().endsWith('CASE')) {
        const shift = selectIndent.length
        for (let index = 0; index < formatted.length; index += 1) {
          const line = formatted[index] as string
          formatted[index] = line.startsWith(selectIndent) ? line.slice(shift) : line
        }
        formatted[0] = `${indent}SELECT ${formatted[0] as string}`
      } else {
        lines.push(`${indent}SELECT`)
      }
    }
    if (comma && formatted.length > 0) formatted[formatted.length - 1] = `${formatted[formatted.length - 1]},`
    lines.push(...formatted)
    selectTokens = []
    current = ''
  }
  const startClause = (phrase: readonly string[]): void => {
    flush()
    const previous = lines[lines.length - 1]?.trim() ?? ''
    if (phrase[0] === 'union' && previous !== '') {
      lines.push('')
    } else if (phrase[0] !== 'union' && /^UNION(?: ALL)?$/u.test(previous)) {
      lines.push('')
    }
    current = phrase.map(part => part.toUpperCase()).join(' ')
  }
  const startBoolean = (keyword: string): void => {
    flush()
    current = `${' '.repeat(2)}${keyword.toUpperCase()}`
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const currentToken = tokens[index] as Token
    if (currentToken.text === '(') depth += 1
    if (currentToken.text === ')') depth = Math.max(0, depth - 1)

    if (currentToken.kind === 'line-comment') {
      if (selectMode) {
        if (selectTokens.length > 0) flushSelect(false)
        if (currentToken.ownLine) lines.push(`${selectIndent}${currentToken.text}`)
        else if (lines.length > 0) lines[lines.length - 1] = `${lines[lines.length - 1]} ${currentToken.text}`
        else lines.push(`${selectIndent}${currentToken.text}`)
      } else if (currentToken.ownLine) {
        flush()
        lines.push(`${indent}${currentToken.text}`)
      } else if (current.trim() === '') {
        lines.push(`${indent}${currentToken.text}`)
      } else {
        current = `${current.trimEnd()} ${currentToken.text}`
        flush()
      }
      continue
    }
    if (currentToken.kind === 'block-comment') {
      current = append(current, currentToken, tokens[index - 1], indent)
      continue
    }
    if (depth === 0 && currentToken.kind === 'word') {
      const phrase = clauseAt(tokens, index)
      if (phrase) {
        if (selectMode) {
          flushSelect(false)
          selectMode = false
        }
        if (phrase[0] === 'select' && shouldMultilineSelect(tokens, index + 1)) {
          flush()
          selectIndent = `${indent}  `
          selectMode = true
          selectNeedsHeader = true
          selectTokens = []
          current = ''
          index += phrase.length - 1
          between = false
          continue
        }
        startClause(phrase)
        index += phrase.length - 1
        between = false
        continue
      }
      if (currentToken.upper === 'case') {
        if (selectMode) {
          if (selectTokens.length > 0) flushSelect(false)
          if (selectNeedsHeader) {
            lines.push(`${indent}SELECT`)
            selectNeedsHeader = false
          }
        } else {
          flush()
        }
        const result = formatCase(tokens, index, selectMode ? selectIndent : `${indent}  `)
        lines.push(...result.lines)
        index = result.nextIndex - 1
        continue
      }
      if (currentToken.upper === 'and' || currentToken.upper === 'or') {
        if (currentToken.upper === 'and' && between) {
          between = false
        } else {
          startBoolean(currentToken.text)
          continue
        }
      }
      if (currentToken.upper === 'between') between = true
    }

    if (currentToken.text === ',') {
      if (selectMode && depth === 0) {
        flushSelect(true)
      } else if (selectMode) {
        selectTokens.push(currentToken)
      } else {
        current = `${current.trimEnd()},`
      }
      continue
    }
    if (currentToken.text === ';') {
      if (selectMode) {
        flushSelect(false)
        selectMode = false
      }
      current = `${current.trimEnd()};`
      flush()
      if (index < tokens.length - 1) lines.push('')
      continue
    }
    if (selectMode) {
      selectTokens.push(currentToken)
      continue
    }
    current = append(current, currentToken, tokens[index - 1], indent)
  }
  if (selectMode) flushSelect(false)
  flush()
  return lines
}

/**
 * Append one token to a line using SQL spacing rules.
 * @param line - Current line.
 * @param next - Token to append.
 * @param previous - Previous token.
 * @param indent - Prefix for continuation lines.
 * @returns Updated line.
 */
function append(line: string, next: Token, previous: Token | undefined, indent: string): string {
  const text = next.kind === 'word' && KEYWORDS.has(next.upper) ? next.text.toUpperCase() : next.text
  const [first, ...rest] = text.split('\n')
  const rendered = rest.length === 0
    ? first
    : `${first}\n${rest.map(part => `${indent}${part}`).join('\n')}`
  if (line === '') return rendered
  return needsSpace(previous, next) ? `${line.trimEnd()} ${rendered}` : `${line}${rendered}`
}

/**
 * Whether a space belongs before a token.
 * @param previous - Previous token.
 * @param next - Next token.
 * @returns `true` when a space is required.
 */
function needsSpace(previous: Token | undefined, next: Token): boolean {
  if (!previous) return false
  if ([',', ';', ')', ']', '::', '.'].includes(next.text)) return false
  if (['(', '[', '::', '.'].includes(previous.text)) return false
  if (next.text === '[') return previous.upper === 'array'
  if (next.text === '(') return SPACE_BEFORE_PAREN.has(previous.upper)
  if (next.text === '*') return true
  if (previous.kind === 'operator' || next.kind === 'operator') return previous.text !== '::' && next.text !== '::'
  return true
}

/**
 * Render tokens as one inline expression.
 * @param tokens - Tokens to join.
 * @returns Inline SQL text.
 */
function formatInline(tokens: readonly Token[]): string {
  return tokens.reduce((line, currentToken, index) => (
    append(line, currentToken, tokens[index - 1], '')
  ), '')
}

/**
 * Return the clause phrase starting at a token index.
 * @param tokens - Statement tokens.
 * @param index - Candidate start.
 * @returns The phrase, or null.
 */
function clauseAt(tokens: readonly Token[], index: number): readonly string[] | null {
  return CLAUSE_PHRASES.find(phrase => phrase.every((part, offset) => (
    tokens[index + offset]?.upper === part
  ))) ?? null
}

/**
 * Find a token at parenthesis depth zero.
 * @param tokens - Statement tokens.
 * @param predicate - Match predicate.
 * @returns Token index, or -1.
 */
function findTopLevel(tokens: readonly Token[], predicate: (candidate: Token) => boolean): number {
  let depth = 0
  for (let index = 0; index < tokens.length; index += 1) {
    const currentToken = tokens[index] as Token
    if (currentToken.text === '(') depth += 1
    if (currentToken.text === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && predicate(currentToken)) return index
  }
  return -1
}

/**
 * Whether a token sequence begins with the given words.
 * @param tokens - Statement tokens.
 * @param words - Expected words.
 * @returns `true` when the prefix matches.
 */
function startsWith(tokens: readonly Token[], words: readonly string[]): boolean {
  return words.every((word, index) => tokens[index]?.upper === word)
}

export const sqlTemplateFormat: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression): void {
        if (!isSqlTag(node.tag)) return
        const placeholders: { interpolation: string, placeholder: string }[] = []
        let raw = ''
        node.quasi.quasis.forEach((quasi, index) => {
          raw += quasi.value.raw
          if (index < node.quasi.expressions.length) {
            const next = node.quasi.quasis[index + 1] as ESTree.TemplateElement
            const interpolation = `\${${context.sourceCode.text.slice(quasi.range[1], next.range[0])}}`
            const width = Math.max(...interpolation.split('\n').map(line => line.length))
            const placeholder = `\u0001${index}\u0001${'\u0002'.repeat(Math.max(0, width - 3))}`
            placeholders.push({ interpolation, placeholder })
            raw += placeholder
          }
        })
        const lineStart = context.sourceCode.getText().lastIndexOf('\n', node.range[0]) + 1
        const baseIndent = context.sourceCode.text.slice(lineStart).match(/^\s*/u)?.[0] ?? ''
        const rawLines = raw.split('\n')
        const firstLine = rawLines.find(line => line.trim() !== '')
        const rawIndent = firstLine?.match(/^\s*/u)?.[0] ?? ''
        const dedented = rawLines.map(line => (
          line.trim() === '' ? '' : line.startsWith(rawIndent) ? line.slice(rawIndent.length) : line
        )).join('\n')
        const formatted = formatSQL(dedented, `${baseIndent}  `)
        let body = `\n${formatted}\n${baseIndent}`
        placeholders.forEach(({ interpolation, placeholder }) => {
          body = body.replace(placeholder, interpolation)
        })
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
