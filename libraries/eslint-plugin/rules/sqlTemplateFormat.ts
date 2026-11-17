/* eslint-disable @typescript-eslint/no-explicit-any -- AST printer boundary over PostgreSQL nodes. */
import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { parse as parsePostgres } from 'postgresql-eslint-parser'

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
function formatLegacySQL(sql: string, indent = ''): string {
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
  if (startsWith(tokens, ['insert'])) return formatInsert(tokens, indent)
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
 * Format an INSERT statement with one row per line.
 * @param tokens - Statement tokens.
 * @param indent - Prefix for this block.
 * @returns Formatted lines.
 */
function formatInsert(tokens: readonly Token[], indent: string): string[] {
  const valuesIndex = tokens.findIndex(candidate => candidate.upper === 'values')
  if (valuesIndex === -1) return formatQuery(tokens, indent)
  const headerTokens = tokens.slice(0, valuesIndex)
  const open = headerTokens.findIndex(candidate => candidate.text === '(')
  if (open === -1) return formatQuery(tokens, indent)
  const close = matchingParen(headerTokens, open)
  if (close === -1) return formatQuery(tokens, indent)
  const header = formatInline(headerTokens.slice(0, open))
  const columns = formatInline(headerTokens.slice(open, close + 1))
  const rows = splitList(tokens.slice(valuesIndex + 1))
  const lines = [`${indent}${header} ${columns}`, `${indent}VALUES`]
  rows.forEach((row, index) => {
    lines.push(`${indent}  ${formatInline(row)}${index < rows.length - 1 ? ',' : ''}`)
  })
  return lines
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
  const text = next.kind === 'word' && KEYWORDS.has(next.upper) && previous?.upper !== 'as'
    ? next.text.toUpperCase()
    : next.text
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

/**
 * Format one SQL template body through the PostgreSQL AST.
 * Falls back to the legacy formatter for comments, DDL, and unsupported nodes.
 * @param sql - SQL text with expression placeholders.
 * @param indent - Prefix for every formatted line.
 * @returns Formatted SQL text.
 */
export function formatSQL(sql: string, indent = ''): string {
  const placeholders = new Map<string, string>()
  let safeSql = ''
  for (let index = 0; index < sql.length;) {
    if (sql[index] === '\u0001') {
      const close = sql.indexOf('\u0001', index + 1)
      const digits = sql.slice(index + 1, close)
      if (close !== -1 && /^\d+$/u.test(digits)) {
        let end = close + 1
        while (sql[end] === '\u0002') end += 1
        const original = sql.slice(index, end)
        const safe = `__basis_p${digits}_${'_'.repeat(end - close - 1)}__`
        placeholders.set(safe, original)
        safeSql += safe
        index = end
        continue
      }
    }
    safeSql += sql[index]
    index += 1
  }
  try {
    const ast = parsePostgres(safeSql) as any
    if ((ast.comments?.length ?? 0) > 0) return formatLegacySQL(sql, indent)
    if (!ast.body?.length) return ''
    const printer = new AstPrinter(safeSql, ast.tokens ?? [])
    let formatted = ast.body.map((node: any) => printer.statement(node, indent)).join(';\n\n')
    for (const [safe, original] of placeholders) {
      formatted = formatted.replace(new RegExp(safe, 'giu'), original)
    }
    if (formatted.split('\n').some(line => line.length > 100)) return formatLegacySQL(sql, indent)
    return formatted
  } catch {
    return formatLegacySQL(sql, indent)
  }
}

/** Prints PostgreSQL AST nodes in the canonical Basis layout. */
class AstPrinter {
  constructor(private readonly source: string, private readonly tokens: readonly any[]) {}

  /**
   * Print one statement.
   * @param node - Statement node.
   * @param indent - Prefix for this statement.
   * @returns Formatted SQL.
   */
  statement(node: any, indent: string): string {
    if (!this.supported(node, new Set())) {
      return formatLegacySQL(this.text(node) || this.source, indent)
    }
    return this.lines(node, '')
      .flatMap(line => line.split('\n'))
      .map(line => `${indent}${line}`)
      .join('\n')
  }

  /**
   * Check whether every node in a statement is safe for this printer.
   * @param node - Candidate node or value.
   * @param seen - Nodes already visited.
   * @returns Whether the printer supports the subtree.
   */
  supported(node: any, seen: Set<object>): boolean {
    if (!node || typeof node !== 'object') return true
    if (seen.has(node)) return true
    seen.add(node)
    if (Array.isArray(node)) return node.every(item => this.supported(item, seen))
    if (typeof node.type !== 'string') return true
    if (!this.supportedType(node)) return false
    return Object.entries(node).every(([key, value]) => (
      ['parent', 'loc', 'range', 'type'].includes(key) || this.supported(value, seen)
    ))
  }

  /**
   * Check whether one node type is supported.
   * @param node - Candidate node.
   * @returns Whether this node's own fields are supported.
   */
  supportedType(node: any): boolean {
    switch (node.type) {
      case 'SelectStmt':
        return !node.distinctClause?.length
          && !node.intoClause
          && !node.windowClause?.length
          && !node.lockingClause?.length
          && !node.sampleClause
          && (!node.limitOption || node.limitOption === 'LIMIT_OPTION_DEFAULT')
      case 'InsertStmt':
        return !node.withClause
          && !node.relation?.alias
          && !node.relation?.schemaname
          && !node.relation?.catalogname
          && (!node.override || node.override === 'OVERRIDING_NOT_SET')
          && (!node.onConflictClause || !node.onConflictClause.constraint)
          && (!node.onConflictClause?.indexElems || node.onConflictClause.indexElems.every((elem: any) => (
            elem?.type === 'IndexElem' && Boolean(elem.name) && !elem.expr && !elem.collation && !elem.opclass
            && (!elem.ordering || elem.ordering === 'SORTBY_DEFAULT')
            && (!elem.nulls_ordering || elem.nulls_ordering === 'SORTBY_NULLS_DEFAULT')
          )))
      case 'ViewStmt':
        return !node.aliases?.length
          && !node.options?.length
          && !node.withCheckOption
          && !node.view?.schemaname
          && !node.view?.catalogname
      case 'RangeVar':
        return !node.schemaname
          && !node.catalogname
          && !node.alias?.colnames?.length
      case 'JoinExpr':
        return !node.usingClause?.length && !node.isNatural && !node.alias
      case 'ResTarget':
        return !node.indirection?.length
      case 'ColumnRef':
        return !node.indirection?.length
          && (node.fields ?? []).every((field: any) => field?.type === 'String' || field?.type === 'A_Star')
      case 'A_Expr': {
        const kinds = [
          'AEXPR_OP', 'AEXPR_OP_ANY', 'AEXPR_OP_ALL', 'AEXPR_LIKE', 'AEXPR_ILIKE',
          'AEXPR_IN', 'AEXPR_BETWEEN', 'AEXPR_NOT_BETWEEN', 'AEXPR_BETWEEN_SYM',
          'AEXPR_NOT_BETWEEN_SYM', 'AEXPR_DISTINCT', 'AEXPR_NOT_DISTINCT', 'AEXPR_NULLIF',
        ]
        return kinds.includes(node.kind)
          && Boolean(node.lexpr && node.rexpr)
          && Boolean(node.name?.length)
          && node.lexpr?.type !== 'A_Expr'
          && node.rexpr?.type !== 'A_Expr'
      }
      case 'BoolExpr':
        return ['AND_EXPR', 'OR_EXPR', 'NOT_EXPR'].includes(node.boolop)
      case 'FuncCall':
        return !node.over
          && !node.agg_order?.length
          && !node.agg_filter
          && !node.func_variadic
          && !node.agg_within_group
          && Boolean(node.funcname?.length)
      case 'SortBy':
        return node.sortby_dir !== 'SORTBY_USING'
      case 'TypeCast':
        return Boolean(node.typeName?.range)
      case 'BooleanTest':
        return ['IS_TRUE', 'IS_NOT_TRUE', 'IS_FALSE', 'IS_NOT_FALSE'].includes(node.booltesttype)
      case 'CommonTableExpr':
        return (!node.ctematerialized || node.ctematerialized === 'CTEMaterializeDefault')
          && !node.aliascolnames?.length
          && !node.search_clause
          && !node.cycle_clause
      case 'A_Const':
      case 'ParamRef':
      case 'CoalesceExpr':
      case 'NullTest':
      case 'CaseExpr':
      case 'CaseWhen':
      case 'Alias':
      case 'List':
      case 'ctes':
      case 'targetList':
      case 'names':
      case 'infer':
      case 'IndexElem':
      case 'String':
      case 'A_Star':
        return true
      default:
        return false
    }
  }

  /**
   * Slice the original source for one node.
   * @param node - AST node.
   * @returns Source text.
   */
  text(node: any): string {
    if (!node?.range) return ''
    return this.source.slice(node.range[0], node.range[1])
  }

  /**
   * Format one statement or select node.
   * @param node - AST node.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  lines(node: any, indent: string): string[] {
    const normalized = this.normalizeSelect(node)
    switch (normalized?.type) {
      case 'SelectStmt': return this.select(normalized, indent)
      case 'InsertStmt': return this.insert(normalized, indent)
      case 'ViewStmt': return this.view(normalized, indent)
      default: return formatLegacySQL(this.text(normalized) || this.source, indent).split('\n')
    }
  }

  /**
   * Repair the parser's flattened set-operation branches.
   * @param node - Candidate select node.
   * @returns A normal SelectStmt-shaped node.
   */
  normalizeSelect(node: any): any {
    if (node?.type !== 'targetList') return node
    const targetList = Object.keys(node)
      .filter(key => /^\d+$/u.test(key))
      .map(key => node[key])
    return { ...node, targetList, type: 'SelectStmt' }
  }

  /**
   * Find the boundary after a target list entry.
   * @param node - SelectStmt.
   * @param targets - Target-list nodes.
   * @param index - Target index.
   * @returns Byte offset where the target's clause ends.
   */
  targetBoundary(node: any, targets: readonly any[], index: number): number {
    if (index < targets.length - 1) return targets[index + 1].range?.[0] ?? Number.MAX_SAFE_INTEGER
    const starts = [
      node.fromClause?.[0],
      node.whereClause,
      node.groupClause?.[0],
      node.havingClause,
      node.sortClause?.[0],
      node.limitCount,
      node.limitOffset,
    ].map(item => item?.range?.[0]).filter((value: number | undefined): value is number => value !== undefined)
    return Math.min(...starts, node.range?.[1] ?? Number.MAX_SAFE_INTEGER)
  }

  /**
   * Format a SELECT statement.
   * @param node - SelectStmt.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  select(node: any, indent: string): string[] {
    if (node.withClause) return this.withSelect(node, indent)
    if (node.op && node.op !== 'SETOP_NONE') return this.setOperation(node, indent)
    if (node.valuesLists) return this.values(node.valuesLists, indent)
    const targetNodes = node.targetList ?? []
    const targets = targetNodes.map((target: any, index: number) => (
      this.target(target, this.targetBoundary(node, targetNodes, index))
    ))
    const targetText = targets.map((target: string[]) => target.join(' ')).join(', ')
    const multiline = targets.some((target: string[]) => target.length > 1)
      || (`${indent}SELECT ${targetText}`.length > 100)
    const lines: string[] = []
    if (multiline) {
      lines.push(`${indent}SELECT`)
      targets.forEach((target: string[], index: number) => {
        const copy = target.map(line => `${indent}  ${line}`)
        if (index < targets.length - 1 && copy.length > 0) copy[copy.length - 1] = `${copy[copy.length - 1]},`
        lines.push(...copy)
      })
    } else {
      lines.push(`${indent}SELECT ${targetText}`)
    }
    if (node.fromClause?.length) lines.push(...this.from(node.fromClause, indent))
    if (node.whereClause) lines.push(...this.condition(node.whereClause, indent, 'WHERE'))
    if (node.groupClause?.length) {
      lines.push(`${indent}GROUP BY ${node.groupClause.map((item: any) => this.expr(item)).join(', ')}`)
    }
    if (node.havingClause) lines.push(...this.condition(node.havingClause, indent, 'HAVING'))
    if (node.sortClause?.length) {
      lines.push(`${indent}ORDER BY ${node.sortClause.map((item: any) => this.sort(item)).join(', ')}`)
    }
    if (node.limitCount) lines.push(`${indent}LIMIT ${this.expr(node.limitCount)}`)
    if (node.limitOffset) lines.push(`${indent}OFFSET ${this.expr(node.limitOffset)}`)
    return lines
  }

  /**
   * Format a target-list entry.
   * @param node - ResTarget.
   * @param boundary - Byte offset where the target's clause ends.
   * @returns Target lines without the outer indentation.
   */
  target(node: any, boundary: number): string[] {
    const alias = this.alias(node, boundary)
    if (node.val?.type === 'CaseExpr') return this.caseExpression(node.val, alias)
    return [`${this.expr(node.val)}${alias}`]
  }

  /**
   * Resolve an alias from the tokens after a target expression.
   * @param node - ResTarget.
   * @param boundary - Byte offset where the target's clause ends.
   * @returns ` AS alias`, or empty.
   */
  alias(node: any, boundary: number): string {
    if (!node?.name) return ''
    const tokens = this.tokens.filter((candidate: any) => (
      node.range && candidate.range[1] <= boundary && candidate.range[0] >= (node.range?.[1] ?? 0)
    )).filter((candidate: any) => candidate.value !== ',')
    const asIndex = tokens.findIndex((candidate: any) => candidate.value.toLowerCase() === 'as')
    const alias = asIndex >= 0 ? tokens[asIndex + 1] : tokens[tokens.length - 1]
    return alias ? ` AS ${alias.value}` : ` AS ${node.name}`
  }

  /**
   * Format FROM entries.
   * @param items - From-clause nodes.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  from(items: readonly any[], indent: string): string[] {
    const [first, ...rest] = items
    const firstText = this.fromItem(first).replace(/\n/gu, `\n${indent}`)
    const lines = [`${indent}FROM ${firstText}`]
    for (const item of rest) {
      lines.push(`${indent}, ${this.fromItem(item).replace(/\n/gu, `\n${indent}`)}`)
    }
    return lines
  }

  /**
   * Format one FROM item.
   * @param node - RangeVar or JoinExpr.
   * @returns Inline text.
   */
  fromItem(node: any): string {
    if (node?.type !== 'JoinExpr') {
      const base = this.expr(node)
      if (!node?.alias) return base
      const between = node.range && node.alias.range
        ? this.source.slice(node.range[1], node.alias.range[0])
        : ''
      const as = /\bas\b/iu.test(between) ? ' AS' : ''
      return `${base}${as} ${this.text(node.alias)}`
    }
    const cross = !node.quals && !node.usingClause?.length && !node.isNatural
    const join = cross ? 'CROSS JOIN' : this.joinName(node.jointype)
    const left = this.fromItem(node.larg)
    const right = this.fromItem(node.rarg)
    const on = node.quals ? ` ON ${this.expr(node.quals)}` : ''
    return `${left}\n${join} ${right}${on}`
  }

  /**
   * Map a JoinType to SQL.
   * @param jointype - JoinType enum.
   * @returns Join keyword.
   */
  joinName(jointype: string): string {
    switch (jointype) {
      case 'JOIN_LEFT': return 'LEFT JOIN'
      case 'JOIN_RIGHT': return 'RIGHT JOIN'
      case 'JOIN_FULL': return 'FULL JOIN'
      case 'JOIN_CROSS': return 'CROSS JOIN'
      case 'JOIN_INNER': return 'JOIN'
      default: return 'JOIN'
    }
  }

  /**
   * Format a WHERE/HAVING condition, splitting top-level booleans.
   * @param node - Condition node.
   * @param indent - Prefix for this block.
   * @param keyword - WHERE or HAVING.
   * @returns Formatted lines.
   */
  condition(node: any, indent: string, keyword: string): string[] {
    if (node?.type !== 'BoolExpr' || (node.boolop !== 'AND_EXPR' && node.boolop !== 'OR_EXPR')) {
      return [`${indent}${keyword} ${this.expr(node)}`]
    }
    const operator = node.boolop === 'AND_EXPR' ? 'AND' : 'OR'
    const [first, ...rest] = node.args ?? []
    const lines = [`${indent}${keyword} ${this.expr(first)}`]
    for (const arg of rest) lines.push(`${indent}  ${operator} ${this.expr(arg)}`)
    return lines
  }

  /**
   * Format a WITH query.
   * @param node - SelectStmt with withClause.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  withSelect(node: any, indent: string): string[] {
    const withClause = node.withClause
    const ctes = Object.keys(withClause)
      .filter(key => /^\d+$/u.test(key))
      .map(key => withClause[key])
      .filter((cte: any) => cte?.type === 'CommonTableExpr')
    const lines: string[] = []
    const prefix = withClause.recursive ? 'WITH RECURSIVE' : 'WITH'
    ctes.forEach((cte: any, index: number) => {
      const name = this.text(cte) || cte.ctename
      const lead = index === 0 ? `${indent}${prefix}` : indent
      lines.push(`${lead} ${name} AS (`)
      lines.push(...this.lines(cte.ctequery, `${indent}  `))
      lines.push(`${indent})${index < ctes.length - 1 ? ',' : ''}`)
    })
    const rest = { ...node, withClause: undefined }
    lines.push(...this.select(rest, indent))
    return lines
  }

  /**
   * Format a set operation.
   * @param node - SelectStmt with larg/rarg.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  setOperation(node: any, indent: string): string[] {
    const operator = node.op === 'SETOP_INTERSECT'
      ? 'INTERSECT'
      : node.op === 'SETOP_EXCEPT' ? 'EXCEPT' : 'UNION'
    const keyword = node.all ? `${operator} ALL` : operator
    return [
      ...this.lines(this.normalizeSelect(node.larg), indent),
      '',
      `${indent}${keyword}`,
      '',
      ...this.lines(this.normalizeSelect(node.rarg), indent),
    ]
  }

  /**
   * Format a VALUES query.
   * @param rows - valuesLists nodes.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  values(rows: readonly any[], indent: string): string[] {
    const lines = [`${indent}VALUES`]
    rows.forEach((row: any, index: number) => {
      const items = (row.items ?? []).map((item: any) => this.expr(item)).join(', ')
      lines.push(`${indent}  (${items})${index < rows.length - 1 ? ',' : ''}`)
    })
    return lines
  }

  /**
   * Format a CREATE VIEW statement.
   * @param node - ViewStmt.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  view(node: any, indent: string): string[] {
    const name = this.expr(node.view)
    const replace = node.replace ? 'OR REPLACE ' : ''
    return [
      `${indent}CREATE ${replace}VIEW ${name} AS (`,
      ...this.lines(node.query, `${indent}  `),
      `${indent})`,
    ]
  }

  /**
   * Format an INSERT statement.
   * @param node - InsertStmt.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  insert(node: any, indent: string): string[] {
    const select = node.selectStmt
    if (!select?.valuesLists) return formatLegacySQL(this.text(node), indent).split('\n')
    const relation = this.expr(node.relation)
    const columns = (node.cols ?? []).map((column: any) => this.text(column) || column.name)
    const header = columns.length > 0
      ? `${indent}INSERT INTO ${relation} (${columns.join(', ')})`
      : `${indent}INSERT INTO ${relation}`
    const lines = [header, ...this.values(select.valuesLists, indent)]
    if (node.onConflictClause) lines.push(...this.onConflict(node.onConflictClause, indent))
    if (node.returningList?.length) {
      const returning = node.returningList.map((target: any, index: number) => (
        this.target(target, this.listBoundary(node.returningList, index, node.range?.[1]))
      )).map((target: string[]) => target.join(' ')).join(', ')
      lines.push(`${indent}RETURNING ${returning}`)
    }
    return lines
  }

  /**
   * Format an ON CONFLICT clause.
   * @param node - OnConflictClause node.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  onConflict(node: any, indent: string): string[] {
    const target = node.indexElems?.length
      ? ` (${node.indexElems.map((elem: any) => elem.name).join(', ')})`
      : ''
    const action = node.action === 'ONCONFLICT_NOTHING' ? 'DO NOTHING' : 'DO UPDATE'
    const updates = node.targetList ?? []
    if (updates.length === 0) return [`${indent}ON CONFLICT${target} ${action}`]
    if (updates.length === 1) {
      const update = updates[0]
      const name = this.text(update) || update.name
      return [`${indent}ON CONFLICT${target} ${action} SET ${name} = ${this.expr(update.val)}`]
    }
    const lines = [`${indent}ON CONFLICT${target} ${action} SET`]
    updates.forEach((update: any, index: number) => {
      const name = this.text(update) || update.name
      lines.push(`${indent}  ${name} = ${this.expr(update.val)}${index < updates.length - 1 ? ',' : ''}`)
    })
    return lines
  }

  /**
   * Find the boundary after an item in a target list.
   * @param items - Target nodes.
   * @param index - Item index.
   * @param end - End of the enclosing statement.
   * @returns Byte offset where the item ends.
   */
  listBoundary(items: readonly any[], index: number, end = Number.MAX_SAFE_INTEGER): number {
    return index < items.length - 1 ? items[index + 1].range?.[0] ?? end : end
  }

  /**
   * Format a CASE expression.
   * @param node - CaseExpr.
   * @param alias - Alias suffix.
   * @returns Formatted lines.
   */
  caseExpression(node: any, alias: string): string[] {
    const lines = [`CASE${node.arg ? ` ${this.expr(node.arg)}` : ''}`]
    for (const when of node.args ?? []) {
      lines.push(`  WHEN ${this.expr(when.expr)} THEN ${this.expr(when.result)}`)
    }
    if (node.defresult) lines.push(`  ELSE ${this.expr(node.defresult)}`)
    lines.push(`END${alias}`)
    return lines
  }

  /**
   * Format a sort item.
   * @param node - SortBy.
   * @returns Inline text.
   */
  sort(node: any): string {
    const direction = node.sortby_dir === 'SORTBY_DESC' ? ' DESC'
      : node.sortby_dir === 'SORTBY_ASC' ? ' ASC'
        : node.sortby_dir === 'SORTBY_USING' ? ` USING ${node.useOp}` : ''
    const nulls = node.sortby_nulls === 'SORTBY_NULLS_FIRST' ? ' NULLS FIRST'
      : node.sortby_nulls === 'SORTBY_NULLS_LAST' ? ' NULLS LAST' : ''
    return `${this.expr(node.node)}${direction}${nulls}`
  }

  /**
   * Format an expression inline.
   * @param node - Expression node.
   * @returns Inline SQL.
   */
  expr(node: any): string {
    if (!node) return ''
    switch (node.type) {
      case 'ColumnRef':
        return this.columnRef(node)
      case 'ParamRef':
        return this.text(node)
      case 'A_Const':
        return this.text(node) || this.constant(node)
      case 'A_Expr': {
        const operator = node.name?.[0]?.sval ?? ''
        if (!operator) return this.text(node)
        const left = this.group(node.lexpr)
        const right = this.group(node.rexpr)
        if (node.kind === 'AEXPR_OP_ANY') return `${left} ${operator} ANY (${right})`
        if (node.kind === 'AEXPR_OP_ALL') return `${left} ${operator} ALL (${right})`
        if (node.kind === 'AEXPR_LIKE') return `${left} ${operator === '!~~' ? 'NOT LIKE' : 'LIKE'} ${right}`
        if (node.kind === 'AEXPR_ILIKE') return `${left} ${operator === '!~~*' ? 'NOT ILIKE' : 'ILIKE'} ${right}`
        if (node.kind === 'AEXPR_IN') {
          const items = (node.rexpr?.items ?? []).map((item: any) => this.expr(item)).join(', ')
          return `${left} ${operator === '<>' ? 'NOT IN' : 'IN'} (${items})`
        }
        if (node.kind === 'AEXPR_BETWEEN' || node.kind === 'AEXPR_NOT_BETWEEN'
          || node.kind === 'AEXPR_BETWEEN_SYM' || node.kind === 'AEXPR_NOT_BETWEEN_SYM') {
          const items = (node.rexpr?.items ?? []).map((item: any) => this.expr(item))
          const keyword = node.kind === 'AEXPR_BETWEEN' ? 'BETWEEN'
            : node.kind === 'AEXPR_NOT_BETWEEN' ? 'NOT BETWEEN'
              : node.kind === 'AEXPR_BETWEEN_SYM' ? 'BETWEEN SYMMETRIC' : 'NOT BETWEEN SYMMETRIC'
          return `${left} ${keyword} ${items[0]} AND ${items[1]}`
        }
        if (node.kind === 'AEXPR_DISTINCT') return `${left} IS DISTINCT FROM ${right}`
        if (node.kind === 'AEXPR_NOT_DISTINCT') return `${left} IS NOT DISTINCT FROM ${right}`
        if (node.kind === 'AEXPR_NULLIF') return `NULLIF(${left}, ${right})`
        return `${left} ${operator} ${right}`
      }
      case 'BoolExpr': {
        if (node.boolop === 'NOT_EXPR') return `NOT (${this.expr(node.args?.[0])})`
        const operator = node.boolop === 'AND_EXPR' ? 'AND' : 'OR'
        return `(${(node.args ?? []).map((arg: any) => this.expr(arg)).join(` ${operator} `)})`
      }
      case 'NullTest':
        return `${this.group(node.arg)} IS ${node.nulltesttype === 'IS_NOT_NULL' ? 'NOT ' : ''}NULL`
      case 'BooleanTest': {
        const negated = node.booltesttype === 'IS_NOT_TRUE' || node.booltesttype === 'IS_NOT_FALSE'
        const expected = node.booltesttype?.includes('FALSE') ? 'FALSE' : 'TRUE'
        return `${this.group(node.arg)} IS ${negated ? 'NOT ' : ''}${expected}`
      }
      case 'TypeCast':
        return `${this.group(node.arg)}::${this.text(node.typeName)}`
      case 'FuncCall': {
        const parts = (node.funcname ?? []).map((part: any) => part.sval ?? part.String?.sval ?? '')
        const name = parts.join('.').toUpperCase()
        const distinct = node.agg_distinct ? 'DISTINCT ' : ''
        const args = node.agg_star ? '*' : (node.args ?? []).map((arg: any) => this.expr(arg)).join(', ')
        return `${name}(${distinct}${args})`
      }
      case 'CoalesceExpr':
        return `COALESCE(${(node.args ?? []).map((arg: any) => this.expr(arg)).join(', ')})`
      case 'CaseExpr': {
        const head = `CASE${node.arg ? ` ${this.expr(node.arg)}` : ''}`
        const whens = (node.args ?? []).map((when: any) => (
          `WHEN ${this.expr(when.expr)} THEN ${this.expr(when.result)}`
        ))
        const otherwise = node.defresult ? ` ELSE ${this.expr(node.defresult)}` : ''
        return `${head} ${whens.join(' ')}${otherwise} END`
      }
      case 'A_ArrayExpr':
      case 'RowExpr':
      case 'SubLink':
        return this.text(node)
      default:
        return this.text(node)
    }
  }

  /**
   * Parenthesize an operand when SQL precedence would otherwise change.
   * @param node - Operand node.
   * @returns Grouped inline SQL.
   */
  group(node: any): string {
    const text = this.expr(node)
    return node?.type === 'A_Expr' || node?.type === 'BoolExpr' ? `(${text})` : text
  }

  /**
   * Reconstruct a column reference from its tokens because the parser's field ranges overlap.
   * @param node - ColumnRef.
   * @returns Inline column reference.
   */
  columnRef(node: any): string {
    const fields = node.fields ?? []
    if (fields.length === 0) return this.text(node)
    const start = node.range?.[0] ?? fields[0]?.range?.[0] ?? 0
    const tokens = this.tokens.filter((candidate: any) => candidate.range?.[0] >= start)
    const result: string[] = []
    let cursor = start
    for (const field of fields) {
      if (field.type === 'A_Star') {
        result.push('*')
        continue
      }
      const current = tokens.find((candidate: any) => (
        candidate.range?.[0] >= cursor && candidate.value !== '.' && candidate.value !== ','
      ))
      if (!current) {
        result.push(field.sval)
        continue
      }
      result.push(current.value)
      cursor = (current.range?.[1] ?? cursor) + 1
    }
    return result.join('.')
  }

  /**
   * Format a literal without source range.
   * @param node - A_Const.
   * @returns Inline literal.
   */
  constant(node: any): string {
    if (node.ival) return String(node.ival.ival)
    if (node.fval) return String(node.fval.fval)
    if (node.sval) return `'${node.sval.sval}'`
    if (node.boolval) return node.boolval.boolval ? 'true' : 'false'
    if (node.isnull) return 'NULL'
    return ''
  }
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
