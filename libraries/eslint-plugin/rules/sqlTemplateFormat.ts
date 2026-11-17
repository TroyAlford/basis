/* eslint-disable @typescript-eslint/no-explicit-any -- AST printer boundary over PostgreSQL nodes. */
import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { loadModule, parseSync, scanSync } from 'libpg-query'

await loadModule()

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
    if (hasSqlComments(safeSql)) return formatLegacySQL(sql, indent)
    const parsed = parseSync(safeSql) as any
    if (!parsed.stmts?.length) return ''
    const printer = new LibpgPrinter(safeSql, safeSql.length)
    if (!parsed.stmts.every((raw: any) => printer.supported(raw.stmt))) {
      return formatLegacySQL(sql, indent)
    }
    let formatted = parsed.stmts.map((raw: any) => {
      const start = raw.stmt_location ?? 0
      const end = raw.stmt_len === undefined ? safeSql.length : start + raw.stmt_len
      return new LibpgPrinter(safeSql, end).statement(raw.stmt, indent)
    }).join(';\n\n')
    for (const [safe, original] of placeholders) {
      formatted = formatted.replace(new RegExp(safe, 'giu'), original)
    }
    if (formatted.split('\n').some(line => line.length > 100)) return formatLegacySQL(sql, indent)
    return formatted
  } catch {
    return formatLegacySQL(sql, indent)
  }
}

/**
 * Detect comments without paying for a full token scan on ordinary SQL.
 * @param sql - SQL text.
 * @returns Whether the text contains a SQL comment.
 */
function hasSqlComments(sql: string): boolean {
  if (!/--|\/\*/u.test(sql)) return false
  try {
    return scanSync(sql).tokens.some(candidate => (
      candidate.tokenName === 'SQL_COMMENT' || candidate.tokenName === 'C_COMMENT'
    ))
  } catch {
    return true
  }
}

const ALIAS_STOP_WORDS = new Set([
  'from', 'where', 'group', 'having', 'order', 'limit', 'offset', 'union', 'intersect',
  'except', 'join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'on', 'using',
  'returning', 'set', 'values', 'conflict', 'do', 'for', 'window', 'fetch', 'into', 'select',
  'update', 'delete', 'insert', 'with',
])

/** Prints raw libpg-query statements in the canonical Basis layout. */
class LibpgPrinter {
  constructor(private readonly source: string, private readonly end: number) {}

  /**
   * Print one statement.
   * @param node - Raw statement node.
   * @param indent - Prefix for every line.
   * @returns Formatted SQL.
   */
  statement(node: any, indent: string): string {
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
  supported(node: any, seen = new Set<object>()): boolean {
    if (!node || typeof node !== 'object') return true
    if (seen.has(node)) return true
    seen.add(node)
    if (Array.isArray(node)) return node.every(item => this.supported(item, seen))
    const tagged = this.tag(node)
    if (!tagged) {
      return Object.entries(node).every(([key, value]) => key === 'location' || this.supported(value, seen))
    }
    const [type, body] = tagged
    if (!this.supportedNode(type, body)) return false
    return Object.entries(body).every(([key, value]) => key === 'location' || this.supported(value, seen))
  }

  /**
   * Check whether one node type is supported.
   * @param type - Raw node tag.
   * @param body - Raw node body.
   * @returns Whether this node's own fields are supported.
   */
  supportedNode(type: string, body: any): boolean {
    switch (type) {
      case 'SelectStmt':
        return !body.distinctClause?.length
          && !body.intoClause
          && !body.windowClause?.length
          && !body.lockingClause?.length
          && !body.sampleClause
          && (!body.limitOption || body.limitOption === 'LIMIT_OPTION_DEFAULT')
      case 'InsertStmt':
        return !body.withClause
          && (!body.override || body.override === 'OVERRIDING_NOT_SET')
          && (!body.onConflictClause || !body.onConflictClause.constraint)
      case 'ViewStmt':
        return !body.aliases?.length
          && !body.options?.length
          && (!body.withCheckOption || body.withCheckOption === 'NO_CHECK_OPTION')
      case 'RangeVar':
        return !body.alias?.colnames?.length
      case 'JoinExpr':
        return !body.usingClause?.length && !body.isNatural && !body.alias
      case 'ResTarget':
        return !body.indirection?.length
      case 'ColumnRef':
        return !body.indirection?.length
          && (body.fields ?? []).every((field: any) => ['String', 'A_Star'].includes(this.tag(field)?.[0] ?? ''))
      case 'A_Expr': {
        const kinds = [
          'AEXPR_OP', 'AEXPR_OP_ANY', 'AEXPR_OP_ALL', 'AEXPR_LIKE', 'AEXPR_ILIKE',
          'AEXPR_IN', 'AEXPR_BETWEEN', 'AEXPR_NOT_BETWEEN', 'AEXPR_BETWEEN_SYM',
          'AEXPR_NOT_BETWEEN_SYM', 'AEXPR_DISTINCT', 'AEXPR_NOT_DISTINCT', 'AEXPR_NULLIF',
        ]
        return kinds.includes(body.kind)
          && Boolean(body.lexpr && body.rexpr)
          && Boolean(body.name?.length)
          && this.tag(body.lexpr)?.[0] !== 'A_Expr'
          && this.tag(body.rexpr)?.[0] !== 'A_Expr'
      }
      case 'BoolExpr':
        return ['AND_EXPR', 'OR_EXPR', 'NOT_EXPR'].includes(body.boolop)
      case 'FuncCall':
        return !body.over
          && !body.agg_order?.length
          && !body.agg_filter
          && !body.func_variadic
          && !body.agg_within_group
          && Boolean(body.funcname?.length)
      case 'SortBy':
        return body.sortby_dir !== 'SORTBY_USING' && !body.useOp?.length
      case 'TypeCast':
        return Boolean(body.typeName)
      case 'BooleanTest':
        return ['IS_TRUE', 'IS_NOT_TRUE', 'IS_FALSE', 'IS_NOT_FALSE'].includes(body.booltesttype)
      case 'CommonTableExpr':
        return (!body.ctematerialized || body.ctematerialized === 'CTEMaterializeDefault')
          && !body.aliascolnames?.length
          && !body.search_clause
          && !body.cycle_clause
      case 'IndexElem':
        return Boolean(body.name)
          && !body.expr
          && !body.collation
          && !body.opclass
          && (!body.ordering || body.ordering === 'SORTBY_DEFAULT')
          && (!body.nulls_ordering || body.nulls_ordering === 'SORTBY_NULLS_DEFAULT')
      case 'A_Const':
      case 'ParamRef':
      case 'CoalesceExpr':
      case 'NullTest':
      case 'CaseExpr':
      case 'CaseWhen':
      case 'List':
      case 'String':
      case 'A_Star':
        return true
      default:
        return false
    }
  }

  /**
   * Return the tag and body of a raw PostgreSQL node.
   * @param node - Candidate node.
   * @returns Tag and body, or null for a plain object.
   */
  tag(node: any): [string, any] | null {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null
    const keys = Object.keys(node).filter(key => (
      key !== 'location'
      && /^[A-Z]/u.test(key)
      && node[key]
      && typeof node[key] === 'object'
      && !Array.isArray(node[key])
    ))
    return keys.length === 1 ? [keys[0] as string, node[keys[0] as string]] : null
  }

  /**
   * Read a node's byte location.
   * @param node - Candidate node.
   * @returns Location, or -1.
   */
  location(node: any): number {
    const tagged = this.tag(node)
    return typeof tagged?.[1]?.location === 'number' ? tagged[1].location : -1
  }

  /**
   * Find the first source position in a node.
   * @param node - Candidate node.
   * @returns Location, or -1.
   */
  startLocation(node: any): number {
    if (!node) return -1
    if (Array.isArray(node)) return this.startLocation(node[0])
    const tagged = this.tag(node)
    if (!tagged) return -1
    const [type, body] = tagged
    if (typeof body.location === 'number' && body.location >= 0) return body.location
    switch (type) {
      case 'JoinExpr': return this.startLocation(body.larg)
      case 'SortBy': return this.startLocation(body.node)
      case 'TypeCast': return this.startLocation(body.arg)
      case 'A_Expr': return this.startLocation(body.lexpr)
      case 'BoolExpr': return this.startLocation(body.args?.[0])
      case 'NullTest': return this.startLocation(body.arg)
      case 'BooleanTest': return this.startLocation(body.arg)
      default: return -1
    }
  }

  /**
   * Read an identifier or star from the source.
   * @param index - Start byte.
   * @returns Token text and end byte.
   */
  readName(index: number): { end: number, text: string } {
    let cursor = index
    const first = this.source[cursor] ?? ''
    if (first === '"') {
      cursor += 1
      while (cursor < this.source.length) {
        if (this.source[cursor] === '"') {
          if (this.source[cursor + 1] === '"') {
            cursor += 2
            continue
          }
          cursor += 1
          break
        }
        cursor += 1
      }
      return { end: cursor, text: this.source.slice(index, cursor) }
    }
    if (first === '*') return { end: cursor + 1, text: '*' }
    if (!/[A-Za-z_]/u.test(first)) return { end: cursor, text: '' }
    cursor += 1
    while (/[A-Za-z0-9_$]/u.test(this.source[cursor] ?? '')) cursor += 1
    return { end: cursor, text: this.source.slice(index, cursor) }
  }

  /**
   * Read a dotted identifier from the source.
   * @param index - Start byte.
   * @param count - Number of name parts.
   * @returns Qualified text and end byte.
   */
  readQualifiedName(index: number, count: number): { end: number, text: string } {
    let cursor = index
    const parts: string[] = []
    for (let part = 0; part < count; part += 1) {
      while (/\s/u.test(this.source[cursor] ?? '')) cursor += 1
      const name = this.readName(cursor)
      if (!name.text) break
      parts.push(name.text)
      cursor = name.end
      if (part < count - 1) {
        while (/\s/u.test(this.source[cursor] ?? '')) cursor += 1
        if (this.source[cursor] !== '.') break
        cursor += 1
      }
    }
    return { end: cursor, text: parts.join('.') }
  }

  /**
   * Read a type name from the source.
   * @param index - Start byte.
   * @returns Type text.
   */
  readTypeName(index: number): string {
    let cursor = index
    while (/\s/u.test(this.source[cursor] ?? '')) cursor += 1
    const start = cursor
    let name = this.readName(cursor)
    if (!name.text) return ''
    cursor = name.end
    let end = cursor
    while (true) {
      while (/\s/u.test(this.source[cursor] ?? '')) cursor += 1
      if (this.source[cursor] !== '.') break
      cursor += 1
      name = this.readName(cursor)
      if (!name.text) break
      cursor = name.end
      end = cursor
    }
    while (/\s/u.test(this.source[cursor] ?? '')) cursor += 1
    if (this.source[cursor] === '(') {
      let depth = 0
      while (cursor < this.source.length) {
        if (this.source[cursor] === '(') depth += 1
        if (this.source[cursor] === ')') depth -= 1
        cursor += 1
        if (depth === 0) break
      }
      end = cursor
    }
    while (this.source[cursor] === '[') {
      const close = this.source.indexOf(']', cursor + 1)
      if (close === -1) break
      cursor = close + 1
      end = cursor
    }
    return this.source.slice(start, end)
  }

  /**
   * Read a literal from the source.
   * @param index - Start byte.
   * @returns Literal text.
   */
  readLiteral(index: number): string {
    let cursor = index
    while (/\s/u.test(this.source[cursor] ?? '')) cursor += 1
    const start = cursor
    const first = this.source[cursor] ?? ''
    if (first === "'") {
      cursor += 1
      while (cursor < this.source.length) {
        if (this.source[cursor] === "'") {
          if (this.source[cursor + 1] === "'") {
            cursor += 2
            continue
          }
          cursor += 1
          break
        }
        cursor += 1
      }
      return this.source.slice(start, cursor)
    }
    if ((first === 'B' || first === 'X' || first === 'E') && this.source[cursor + 1] === "'") {
      cursor += 1
      const quoted = this.readLiteral(cursor)
      return `${first}${quoted}`
    }
    if (first === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(this.source.slice(cursor))?.[0]
      if (tag) {
        const close = this.source.indexOf(tag, cursor + tag.length)
        return close === -1 ? this.source.slice(start) : this.source.slice(start, close + tag.length)
      }
    }
    const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/u.exec(this.source.slice(cursor))?.[0]
    if (number) return number
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/u.exec(this.source.slice(cursor))?.[0]
    if (word) return word
    return this.source.slice(cursor, cursor + 1)
  }

  /**
   * Scan a small source segment into lightweight tokens.
   * @param start - Start byte.
   * @param limit - End byte.
   * @returns Tokens in source order.
   */
  scan(start: number, limit: number): { end: number, start: number, text: string }[] {
    const tokens: { end: number, start: number, text: string }[] = []
    let cursor = start
    while (cursor < limit) {
      const character = this.source[cursor] ?? ''
      if (/\s/u.test(character)) {
        cursor += 1
        continue
      }
      if (character === '-' && this.source[cursor + 1] === '-') {
        const newline = this.source.indexOf('\n', cursor + 2)
        cursor = newline === -1 ? limit : newline + 1
        continue
      }
      if (character === '/' && this.source[cursor + 1] === '*') {
        const close = this.source.indexOf('*/', cursor + 2)
        cursor = close === -1 ? limit : close + 2
        continue
      }
      if (character === "'" || character === '"') {
        const quote = character
        let end = cursor + 1
        while (end < limit) {
          if (this.source[end] === quote) {
            if (this.source[end + 1] === quote) {
              end += 2
              continue
            }
            end += 1
            break
          }
          end += 1
        }
        tokens.push({ end, start: cursor, text: this.source.slice(cursor, end) })
        cursor = end
        continue
      }
      if (character === '$') {
        const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(this.source.slice(cursor, limit))?.[0]
        if (tag) {
          const close = this.source.indexOf(tag, cursor + tag.length)
          const end = close === -1 ? limit : close + tag.length
          tokens.push({ end, start: cursor, text: this.source.slice(cursor, end) })
          cursor = end
          continue
        }
      }
      if (/[A-Za-z_]/u.test(character)) {
        let end = cursor + 1
        while (/[A-Za-z0-9_$]/u.test(this.source[end] ?? '')) end += 1
        tokens.push({ end, start: cursor, text: this.source.slice(cursor, end) })
        cursor = end
        continue
      }
      tokens.push({ end: cursor + 1, start: cursor, text: character })
      cursor += 1
    }
    return tokens
  }

  /**
   * Find a target alias and preserve its source spelling.
   * @param body - ResTarget body.
   * @param limit - End of the search segment.
   * @returns Alias suffix, or empty.
   */
  alias(body: any, limit: number): string {
    if (!body.name) return ''
    const start = typeof body.location === 'number' && body.location >= 0 ? body.location : 0
    const top: { text: string }[] = []
    let depth = 0
    for (const current of this.scan(start, limit)) {
      if (current.text === '(') {
        depth += 1
        top.push(current)
        continue
      }
      if (current.text === ')') {
        if (depth === 0) break
        depth -= 1
        top.push(current)
        continue
      }
      if (depth === 0 && (current.text === ',' || current.text === ';')) break
      if (depth === 0 && ALIAS_STOP_WORDS.has(current.text.toLowerCase())) break
      top.push(current)
    }
    const asIndex = top.findIndex(candidate => candidate.text.toLowerCase() === 'as')
    const candidate = asIndex >= 0 ? top[asIndex + 1] : top[top.length - 1]
    return candidate ? ` AS ${candidate.text}` : ` AS ${body.name}`
  }

  /**
   * Print a target-list entry.
   * @param node - ResTarget.
   * @param limit - End of the search segment.
   * @returns Target lines without outer indentation.
   */
  target(node: any, limit: number): string[] {
    const body = this.tag(node)?.[1]
    if (!body) return []
    const tagged = this.tag(body.val)
    const alias = this.alias(body, limit)
    if (tagged?.[0] === 'CaseExpr') return this.caseLines(tagged[1], alias)
    return [`${this.expr(body.val)}${alias}`]
  }

  /**
   * Print a multi-line CASE expression.
   * @param body - CaseExpr body.
   * @param alias - Alias suffix.
   * @returns Formatted lines.
   */
  caseLines(body: any, alias: string): string[] {
    const lines = [`CASE${body.arg ? ` ${this.expr(body.arg)}` : ''}`]
    for (const when of body.args ?? []) {
      const clause = this.tag(when)?.[1]
      if (!clause) continue
      lines.push(`  WHEN ${this.expr(clause.expr)} THEN ${this.expr(clause.result)}`)
    }
    if (body.defresult) lines.push(`  ELSE ${this.expr(body.defresult)}`)
    lines.push(`END${alias}`)
    return lines
  }

  /**
   * Print one statement or select node.
   * @param node - Raw node.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  lines(node: any, indent: string): string[] {
    const tagged = this.tag(node)
    if (!tagged) return []
    switch (tagged[0]) {
      case 'SelectStmt': return this.select(tagged[1], indent)
      case 'InsertStmt': return this.insert(tagged[1], indent)
      case 'ViewStmt': return this.view(tagged[1], indent)
      default: return []
    }
  }

  /**
   * Print a SELECT statement.
   * @param body - SelectStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  select(body: any, indent: string): string[] {
    if (body.withClause) return this.withSelect(body, indent)
    if (body.op && body.op !== 'SETOP_NONE') return this.setOperation(body, indent)
    if (body.valuesLists) return this.values(body.valuesLists, indent)
    const nodes = body.targetList ?? []
    const targets = nodes.map((target: any, index: number) => {
      const next = nodes[index + 1]
      const limit = next ? this.startLocation(next) : this.end
      return this.target(target, limit < 0 ? this.end : limit)
    })
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
    if (body.fromClause?.length) lines.push(...this.from(body.fromClause, indent))
    if (body.whereClause) lines.push(...this.condition(body.whereClause, indent, 'WHERE'))
    if (body.groupClause?.length) {
      lines.push(`${indent}GROUP BY ${body.groupClause.map((item: any) => this.expr(item)).join(', ')}`)
    }
    if (body.havingClause) lines.push(...this.condition(body.havingClause, indent, 'HAVING'))
    if (body.sortClause?.length) {
      lines.push(`${indent}ORDER BY ${body.sortClause.map((item: any) => this.sort(item)).join(', ')}`)
    }
    if (body.limitCount) lines.push(`${indent}LIMIT ${this.expr(body.limitCount)}`)
    if (body.limitOffset) lines.push(`${indent}OFFSET ${this.expr(body.limitOffset)}`)
    return lines
  }

  /**
   * Print a WITH query.
   * @param body - SelectStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  withSelect(body: any, indent: string): string[] {
    const withClause = body.withClause
    const ctes = withClause.ctes ?? []
    const lines: string[] = []
    const prefix = withClause.recursive ? 'WITH RECURSIVE' : 'WITH'
    ctes.forEach((node: any, index: number) => {
      const cte = this.tag(node)?.[1]
      if (!cte) return
      const location = typeof cte.location === 'number' && cte.location >= 0 ? cte.location : -1
      const name = location >= 0 ? this.readName(location).text : cte.ctename
      const lead = index === 0 ? `${indent}${prefix}` : indent
      lines.push(`${lead} ${name} AS (`)
      lines.push(...this.lines(cte.ctequery, `${indent}  `))
      lines.push(`${indent})${index < ctes.length - 1 ? ',' : ''}`)
    })
    const rest = { ...body, withClause: undefined }
    lines.push(...this.select(rest, indent))
    return lines
  }

  /**
   * Print a set operation.
   * @param body - SelectStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  setOperation(body: any, indent: string): string[] {
    const operator = body.op === 'SETOP_INTERSECT'
      ? 'INTERSECT'
      : body.op === 'SETOP_EXCEPT' ? 'EXCEPT' : 'UNION'
    const keyword = body.all ? `${operator} ALL` : operator
    return [
      ...this.selectNode(body.larg, indent),
      '',
      `${indent}${keyword}`,
      '',
      ...this.selectNode(body.rarg, indent),
    ]
  }

  /**
   * Print a SelectStmt body or tagged SelectStmt.
   * @param node - Select node.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  selectNode(node: any, indent: string): string[] {
    const tagged = this.tag(node)
    if (tagged?.[0] === 'SelectStmt') return this.select(tagged[1], indent)
    if (node?.targetList || node?.fromClause || node?.whereClause || node?.valuesLists || node?.op) {
      return this.select(node, indent)
    }
    return []
  }

  /**
   * Print a VALUES query.
   * @param rows - valuesLists nodes.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  values(rows: readonly any[], indent: string): string[] {
    const lines = [`${indent}VALUES`]
    rows.forEach((node: any, index: number) => {
      const row = this.tag(node)?.[1]
      const items = (row?.items ?? []).map((item: any) => this.expr(item)).join(', ')
      lines.push(`${indent}  (${items})${index < rows.length - 1 ? ',' : ''}`)
    })
    return lines
  }

  /**
   * Print FROM entries.
   * @param items - From-clause nodes.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  from(items: readonly any[], indent: string): string[] {
    const lines = [`${indent}FROM ${this.fromItem(items[0]).replace(/\n/gu, `\n${indent}`)}`]
    for (const item of items.slice(1)) {
      lines.push(`${indent}, ${this.fromItem(item).replace(/\n/gu, `\n${indent}`)}`)
    }
    return lines
  }

  /**
   * Print one FROM item.
   * @param node - RangeVar or JoinExpr.
   * @returns Inline text.
   */
  fromItem(node: any): string {
    const tagged = this.tag(node)
    if (tagged?.[0] === 'JoinExpr') {
      const body = tagged[1]
      const cross = !body.quals && !body.usingClause?.length && !body.isNatural
      const join = cross ? 'CROSS JOIN' : this.joinName(body.jointype)
      const left = this.fromItem(body.larg)
      const right = this.fromItem(body.rarg)
      const on = body.quals ? ` ON ${this.expr(body.quals)}` : ''
      return `${left}\n${join} ${right}${on}`
    }
    if (tagged?.[0] === 'RangeVar') return this.rangeVar(tagged[1])
    if (node?.relname) return this.rangeVar(node)
    return ''
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
   * Print a relation name and alias.
   * @param body - RangeVar body.
   * @returns Relation text.
   */
  rangeVar(body: any): string {
    const location = typeof body.location === 'number' && body.location >= 0 ? body.location : -1
    const count = 1 + (body.schemaname ? 1 : 0) + (body.catalogname ? 1 : 0)
    const relation = location >= 0
      ? this.readQualifiedName(location, count)
      : { end: location, text: [body.catalogname, body.schemaname, body.relname].filter(Boolean).join('.') }
    if (!body.alias) return relation.text
    const tokens: { text: string }[] = []
    let depth = 0
    for (const current of this.scan(relation.end, this.end)) {
      if (current.text === '(') {
        depth += 1
        tokens.push(current)
        continue
      }
      if (current.text === ')') {
        if (depth === 0) break
        depth -= 1
        tokens.push(current)
        continue
      }
      if (depth === 0 && (current.text === ',' || current.text === ';')) break
      if (depth === 0 && ALIAS_STOP_WORDS.has(current.text.toLowerCase())) break
      tokens.push(current)
    }
    const asIndex = tokens.findIndex(candidate => candidate.text.toLowerCase() === 'as')
    const candidate = asIndex >= 0 ? tokens[asIndex + 1] : tokens[tokens.length - 1]
    if (!candidate) return `${relation.text} ${body.alias.aliasname}`
    return `${relation.text}${asIndex >= 0 ? ' AS' : ''} ${candidate.text}`
  }

  /**
   * Print a WHERE/HAVING condition, splitting top-level booleans.
   * @param node - Condition node.
   * @param indent - Prefix for this block.
   * @param keyword - WHERE or HAVING.
   * @returns Formatted lines.
   */
  condition(node: any, indent: string, keyword: string): string[] {
    const tagged = this.tag(node)
    if (tagged?.[0] !== 'BoolExpr' || (tagged[1].boolop !== 'AND_EXPR' && tagged[1].boolop !== 'OR_EXPR')) {
      return [`${indent}${keyword} ${this.expr(node)}`]
    }
    const body = tagged[1]
    const operator = body.boolop === 'AND_EXPR' ? 'AND' : 'OR'
    const [first, ...rest] = body.args ?? []
    const lines = [`${indent}${keyword} ${this.expr(first)}`]
    for (const arg of rest) lines.push(`${indent}  ${operator} ${this.expr(arg)}`)
    return lines
  }

  /**
   * Print a sort item.
   * @param node - SortBy.
   * @returns Inline text.
   */
  sort(node: any): string {
    const body = this.tag(node)?.[1]
    if (!body) return ''
    let direction = ''
    if (body.sortby_dir === 'SORTBY_DESC') direction = ' DESC'
    else if (body.sortby_dir === 'SORTBY_ASC') direction = ' ASC'
    else if (body.sortby_dir === 'SORTBY_USING') {
      direction = ` USING ${body.useOp?.map((part: any) => this.expr(part)).join('.')}`
    }
    const nulls = body.sortby_nulls === 'SORTBY_NULLS_FIRST' ? ' NULLS FIRST'
      : body.sortby_nulls === 'SORTBY_NULLS_LAST' ? ' NULLS LAST' : ''
    return `${this.expr(body.node)}${direction}${nulls}`
  }

  /**
   * Print a relation name without its alias.
   * @param body - RangeVar body.
   * @returns Qualified relation name.
   */
  relationName(body: any): string {
    if (!body) return ''
    const count = 1 + (body.schemaname ? 1 : 0) + (body.catalogname ? 1 : 0)
    if (typeof body.location === 'number' && body.location >= 0) {
      return this.readQualifiedName(body.location, count).text
    }
    return [body.catalogname, body.schemaname, body.relname].filter(Boolean).join('.')
  }

  /**
   * Print a CREATE VIEW statement.
   * @param body - ViewStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  view(body: any, indent: string): string[] {
    const view = this.tag(body.view)?.[1] ?? body.view
    const relation = this.relationName(view)
    const replace = body.replace ? 'OR REPLACE ' : ''
    return [
      `${indent}CREATE ${replace}VIEW ${relation} AS (`,
      ...this.lines(body.query, `${indent}  `),
      `${indent})`,
    ]
  }

  /**
   * Print an INSERT statement.
   * @param body - InsertStmt body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  insert(body: any, indent: string): string[] {
    const relation = this.tag(body.relation)?.[1] ?? body.relation
    const relationText = this.relationName(relation)
    const columns = (body.cols ?? []).map((node: any) => {
      const column = this.tag(node)?.[1]
      if (!column) return ''
      return typeof column.location === 'number' && column.location >= 0
        ? this.readName(column.location).text
        : column.name
    }).filter((column: string) => column.length > 0)
    const header = columns.length > 0
      ? `${indent}INSERT INTO ${relationText} (${columns.join(', ')})`
      : `${indent}INSERT INTO ${relationText}`
    const select = this.tag(body.selectStmt)?.[1]
    const lines = [header]
    if (select?.valuesLists) lines.push(...this.values(select.valuesLists, indent))
    else if (select) lines.push(...this.select(select, indent))
    if (body.onConflictClause) lines.push(...this.onConflict(body.onConflictClause, indent))
    const returningList = body.returningClause?.exprs ?? body.returningList ?? []
    if (returningList.length) {
      const returning = returningList.map((node: any, index: number) => {
        const next = returningList[index + 1]
        const limit = next ? this.startLocation(next) : this.end
        return this.target(node, limit < 0 ? this.end : limit).join(' ')
      }).join(', ')
      lines.push(`${indent}RETURNING ${returning}`)
    }
    return lines
  }

  /**
   * Print an ON CONFLICT clause.
   * @param body - OnConflictClause body.
   * @param indent - Prefix for this block.
   * @returns Formatted lines.
   */
  onConflict(body: any, indent: string): string[] {
    const indexElems = body.infer?.indexElems ?? body.indexElems ?? []
    const target = indexElems.length
      ? ` (${indexElems.map((node: any) => {
        const elem = this.tag(node)?.[1]
        if (!elem) return ''
        return typeof elem.location === 'number' && elem.location >= 0
          ? this.readName(elem.location).text
          : elem.name
      }).filter(Boolean).join(', ')})`
      : ''
    const action = body.action === 'ONCONFLICT_NOTHING' ? 'DO NOTHING' : 'DO UPDATE'
    const updates = body.targetList ?? []
    if (updates.length === 0) return [`${indent}ON CONFLICT${target} ${action}`]
    const formatUpdate = (node: any): string => {
      const update = this.tag(node)?.[1]
      if (!update) return ''
      const name = typeof update.location === 'number' && update.location >= 0
        ? this.readName(update.location).text
        : update.name
      return `${name} = ${this.expr(update.val)}`
    }
    if (updates.length === 1) {
      return [`${indent}ON CONFLICT${target} ${action} SET ${formatUpdate(updates[0])}`]
    }
    const lines = [`${indent}ON CONFLICT${target} ${action} SET`]
    updates.forEach((update: any, index: number) => {
      lines.push(`${indent}  ${formatUpdate(update)}${index < updates.length - 1 ? ',' : ''}`)
    })
    return lines
  }

  /**
   * Parenthesize an operand when SQL precedence would otherwise change.
   * @param node - Operand node.
   * @returns Grouped inline SQL.
   */
  group(node: any): string {
    const text = this.expr(node)
    const type = this.tag(node)?.[0]
    return type === 'A_Expr' || type === 'BoolExpr' ? `(${text})` : text
  }

  /**
   * Print an expression inline.
   * @param node - Expression node.
   * @returns Inline SQL.
   */
  expr(node: any): string {
    const tagged = this.tag(node)
    if (!tagged) return ''
    const [type, body] = tagged
    switch (type) {
      case 'ColumnRef': return this.columnRef(body)
      case 'A_Const': return this.literal(body)
      case 'ParamRef': return this.paramRef(body)
      case 'A_Expr': return this.aExpr(body)
      case 'BoolExpr': {
        if (body.boolop === 'NOT_EXPR') return `NOT (${this.expr(body.args?.[0])})`
        const operator = body.boolop === 'AND_EXPR' ? 'AND' : 'OR'
        return `(${(body.args ?? []).map((arg: any) => this.expr(arg)).join(` ${operator} `)})`
      }
      case 'NullTest':
        return `${this.group(body.arg)} IS ${body.nulltesttype === 'IS_NOT_NULL' ? 'NOT ' : ''}NULL`
      case 'BooleanTest': {
        const negated = body.booltesttype === 'IS_NOT_TRUE' || body.booltesttype === 'IS_NOT_FALSE'
        const expected = body.booltesttype?.includes('FALSE') ? 'FALSE' : 'TRUE'
        return `${this.group(body.arg)} IS ${negated ? 'NOT ' : ''}${expected}`
      }
      case 'TypeCast': {
        const typeName = this.tag(body.typeName)?.[1] ?? body.typeName
        const cast = typeName?.location >= 0 ? this.readTypeName(typeName.location) : this.typeNameText(body.typeName)
        return `${this.group(body.arg)}::${cast}`
      }
      case 'FuncCall': return this.funcCall(body)
      case 'CoalesceExpr':
        return `COALESCE(${(body.args ?? []).map((arg: any) => this.expr(arg)).join(', ')})`
      case 'CaseExpr': return this.caseInline(body)
      case 'A_Star': return '*'
      case 'String': return body.sval ?? ''
      default: return ''
    }
  }

  /**
   * Print a column reference and preserve quoting.
   * @param body - ColumnRef body.
   * @returns Column text.
   */
  columnRef(body: any): string {
    const fields = body.fields ?? []
    if (body.location >= 0) {
      const name = this.readQualifiedName(body.location, fields.length)
      if (name.text) return name.text
    }
    return fields.map((field: any) => {
      const tagged = this.tag(field)
      return tagged?.[0] === 'A_Star' ? '*' : tagged?.[1]?.sval ?? ''
    }).join('.')
  }

  /**
   * Print a literal and preserve its source spelling.
   * @param body - A_Const body.
   * @returns Literal text.
   */
  literal(body: any): string {
    if (body.isnull) return 'NULL'
    if (typeof body.location === 'number' && body.location >= 0) {
      const text = this.readLiteral(body.location)
      if (text) return text
    }
    return this.constant(body)
  }

  /**
   * Print a parameter reference.
   * @param body - ParamRef body.
   * @returns Parameter text.
   */
  paramRef(body: any): string {
    if (typeof body.location === 'number' && body.location >= 0) {
      const parameter = /^\$\d+/u.exec(this.source.slice(body.location))?.[0]
      if (parameter) return parameter
    }
    return `$${body.number}`
  }

  /**
   * Print a function call.
   * @param body - FuncCall body.
   * @returns Function call text.
   */
  funcCall(body: any): string {
    const parts = (body.funcname ?? []).map((part: any) => this.tag(part)?.[1]?.sval ?? '')
    const raw = typeof body.location === 'number' && body.location >= 0
      ? this.readQualifiedName(body.location, parts.length).text
      : parts.join('.')
    const name = raw.split('.').map(part => (part.startsWith('"') ? part : part.toUpperCase())).join('.')
    const distinct = body.agg_distinct ? 'DISTINCT ' : ''
    const args = body.agg_star ? '*' : (body.args ?? []).map((arg: any) => this.expr(arg)).join(', ')
    return `${name}(${distinct}${args})`
  }

  /**
   * Print an A_Expr node.
   * @param body - A_Expr body.
   * @returns Inline expression.
   */
  aExpr(body: any): string {
    const operator = body.name?.[0]?.String?.sval ?? ''
    if (!operator) return ''
    const left = this.group(body.lexpr)
    const right = this.group(body.rexpr)
    const items = (): string[] => (this.tag(body.rexpr)?.[1]?.items ?? []).map((item: any) => this.expr(item))
    if (body.kind === 'AEXPR_OP_ANY') return `${left} ${operator} ANY (${right})`
    if (body.kind === 'AEXPR_OP_ALL') return `${left} ${operator} ALL (${right})`
    if (body.kind === 'AEXPR_LIKE') return `${left} ${operator === '!~~' ? 'NOT LIKE' : 'LIKE'} ${right}`
    if (body.kind === 'AEXPR_ILIKE') return `${left} ${operator === '!~~*' ? 'NOT ILIKE' : 'ILIKE'} ${right}`
    if (body.kind === 'AEXPR_IN') return `${left} ${operator === '<>' ? 'NOT IN' : 'IN'} (${items().join(', ')})`
    if (body.kind === 'AEXPR_BETWEEN' || body.kind === 'AEXPR_NOT_BETWEEN'
      || body.kind === 'AEXPR_BETWEEN_SYM' || body.kind === 'AEXPR_NOT_BETWEEN_SYM') {
      const bounds = items()
      const keyword = body.kind === 'AEXPR_BETWEEN' ? 'BETWEEN'
        : body.kind === 'AEXPR_NOT_BETWEEN' ? 'NOT BETWEEN'
          : body.kind === 'AEXPR_BETWEEN_SYM' ? 'BETWEEN SYMMETRIC' : 'NOT BETWEEN SYMMETRIC'
      return `${left} ${keyword} ${bounds[0]} AND ${bounds[1]}`
    }
    if (body.kind === 'AEXPR_DISTINCT') return `${left} IS DISTINCT FROM ${right}`
    if (body.kind === 'AEXPR_NOT_DISTINCT') return `${left} IS NOT DISTINCT FROM ${right}`
    if (body.kind === 'AEXPR_NULLIF') return `NULLIF(${left}, ${right})`
    return `${left} ${operator} ${right}`
  }

  /**
   * Print a CASE expression inline.
   * @param body - CaseExpr body.
   * @returns Inline CASE.
   */
  caseInline(body: any): string {
    const head = `CASE${body.arg ? ` ${this.expr(body.arg)}` : ''}`
    const whens = (body.args ?? []).map((node: any) => {
      const clause = this.tag(node)?.[1]
      return clause ? `WHEN ${this.expr(clause.expr)} THEN ${this.expr(clause.result)}` : ''
    }).filter(Boolean)
    const otherwise = body.defresult ? ` ELSE ${this.expr(body.defresult)}` : ''
    return `${head} ${whens.join(' ')}${otherwise} END`
  }

  /**
   * Print a TypeName without a usable source location.
   * @param body - TypeName body.
   * @returns Type text.
   */
  typeNameText(body: any): string {
    const names = (body.names ?? []).map((name: any) => this.tag(name)?.[1]?.sval ?? '')
    return names[names.length - 1] ?? ''
  }

  /**
   * Print a literal without source location.
   * @param body - A_Const body.
   * @returns Inline literal.
   */
  constant(body: any): string {
    if (body.ival) return String(body.ival.ival)
    if (body.fval) return String(body.fval.fval)
    if (body.sval) return `'${body.sval.sval}'`
    if (body.bsval) return `B'${body.bsval.bsval}'`
    if (body.boolval) return body.boolval.boolval ? 'true' : 'false'
    if (body.isnull) return 'NULL'
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
