import { Operator as QueryOperator } from './Operator'

/** The kind of one query-language token. */
export enum TokenType {
  /** Boolean literal. */
  Boolean = 'boolean',
  /** Argument separator. */
  Comma = 'comma',
  /** End of input. */
  EOF = 'eof',
  /** Rooted field path. */
  Field = 'field',
  /** Opening bracket. */
  LeftBracket = 'leftBracket',
  /** Opening grouping parenthesis. */
  LeftParen = 'leftParen',
  /** Null literal. */
  Null = 'null',
  /** Number literal, preserving its source spelling. */
  Number = 'number',
  /** Comparison or logical operator. */
  Operator = 'operator',
  /** Closing bracket. */
  RightBracket = 'rightBracket',
  /** Closing grouping parenthesis. */
  RightParen = 'rightParen',
  /** Quoted string literal. */
  String = 'string',
  /** Unrecognized input. */
  Unknown = 'unknown',
}

/** A token produced by the query lexer. */
export interface Token {
  /** Exclusive source offset. */
  readonly end: number,
  /** Resolved operator identity for operator tokens. */
  readonly operator?: QueryOperator.Comparison | QueryOperator.Logical,
  /** Original source text for the token. */
  readonly raw: string,
  /** Inclusive source offset. */
  readonly start: number,
  /** Token category. */
  readonly type: TokenType,
  /** Decoded token value; numbers retain their source spelling. */
  readonly value: string | boolean | null,
}

/** A lexer diagnostic with the affected source span. */
export interface QueryDiagnostic {
  /** Exclusive source offset. */
  readonly end: number,
  /** Human-readable problem description. */
  readonly message: string,
  /** Inclusive source offset. */
  readonly start: number,
}

/** The complete lexer result, including recoverable diagnostics. */
export interface LexResult {
  /** Problems found while tokenizing. */
  readonly diagnostics: readonly QueryDiagnostic[],
  /** Tokens in source order, ending with EOF. */
  readonly tokens: readonly Token[],
}

/** Recognized operator spellings, resolved once from the public enums. */
const OPERATORS = new Map<string, QueryOperator.Comparison | QueryOperator.Logical>([
  ...Object.values(QueryOperator.Comparison).map(operator => [operator, operator] as const),
  ...Object.values(QueryOperator.Logical).map(operator => [operator, operator] as const),
  ['=', QueryOperator.Comparison.Equal],
  ['>', QueryOperator.Comparison.GreaterThan],
  ['>=', QueryOperator.Comparison.GreaterThanOrEqual],
  ['<', QueryOperator.Comparison.LessThan],
  ['<=', QueryOperator.Comparison.LessThanOrEqual],
  ['!=', QueryOperator.Comparison.NotEqual],
  ['<>', QueryOperator.Comparison.NotEqual],
  ['!', QueryOperator.Logical.Not],
])

/** Whether a character may begin an identifier. */
const IDENTIFIER_START = /[A-Za-z_]/
/** Whether a character may continue an identifier. */
const IDENTIFIER_PART = /[A-Za-z0-9_]/

/** The query-language lexer. */
export const QueryLexer = {
  /**
   * Tokenize query-language source without executing or parsing it.
   * @param source - Query expression source.
   * @returns Tokens and recoverable diagnostics.
   */
  tokenize(source: string): LexResult {
    const tokens: Token[] = []
    const diagnostics: QueryDiagnostic[] = []
    let index = 0

    while (index < source.length) {
      const character = source[index] as string

      if (/\s/.test(character)) {
        index += 1
        continue
      }

      if (character === '"' || character === "'") {
        const token = stringToken(source, index, diagnostics)
        tokens.push(token)
        index = token.end
        continue
      }

      if (character === '$') {
        const token = operatorToken(source, index, diagnostics)
        tokens.push(token)
        index = token.end
        continue
      }

      if ('=<>!'.includes(character)) {
        const token = symbolicOperatorToken(source, index, diagnostics)
        tokens.push(token)
        index = token.end
        continue
      }

      if ('[](),'.includes(character)) {
        const type = character === '['
          ? TokenType.LeftBracket
          : character === ']'
            ? TokenType.RightBracket
            : character === '('
              ? TokenType.LeftParen
              : character === ')'
                ? TokenType.RightParen
                : TokenType.Comma
        tokens.push({
          end: index + 1,
          raw: character,
          start: index,
          type,
          value: character,
        })
        index += 1
        continue
      }

      if (character === '-' || /[0-9]/.test(character)) {
        const token = numberToken(source, index, diagnostics)
        tokens.push(token)
        index = token.end
        continue
      }

      if (IDENTIFIER_START.test(character)) {
        const token = fieldToken(source, index, diagnostics)
        tokens.push(token)
        index = token.end
        continue
      }

      diagnostics.push({
        end: index + 1,
        message: `Unexpected character ${JSON.stringify(character)}`,
        start: index,
      })
      tokens.push({
        end: index + 1,
        raw: character,
        start: index,
        type: TokenType.Unknown,
        value: character,
      })
      index += 1
    }

    tokens.push({
      end: source.length,
      raw: '',
      start: source.length,
      type: TokenType.EOF,
      value: null,
    })

    return { diagnostics, tokens }
  },
}

/**
 * Read a quoted string token.
 * @param source - Query source.
 * @param start - Opening quote offset.
 * @param diagnostics - Diagnostic sink.
 * @returns The string token.
 */
function stringToken(source: string, start: number, diagnostics: QueryDiagnostic[]): Token {
  const quote = source[start]
  let value = ''
  let index = start + 1

  while (index < source.length) {
    const character = source[index] as string
    if (character === quote) {
      return { end: index + 1, raw: source.slice(start, index + 1), start, type: TokenType.String, value }
    }

    if (character === '\\') {
      const escaped = source[index + 1]
      if (escaped === undefined) break
      value += escape(escaped)
      index += 2
      continue
    }

    value += character
    index += 1
  }

  diagnostics.push({
    end: source.length,
    message: 'Unterminated string literal',
    start,
  })
  return { end: source.length, raw: source.slice(start), start, type: TokenType.String, value }
}

/**
 * Decode one backslash escape.
 * @param character - Escaped character.
 * @returns The decoded character.
 */
function escape(character: string): string {
  switch (character) {
    case 'n': return '\n'
    case 'r': return '\r'
    case 't': return '\t'
    default: return character
  }
}

/**
 * Read an operator token.
 * @param source - Query source.
 * @param start - Dollar-sign offset.
 * @param diagnostics - Diagnostic sink.
 * @returns The operator or unknown token.
 */
function operatorToken(source: string, start: number, diagnostics: QueryDiagnostic[]): Token {
  let end = start + 1
  while (end < source.length && /[A-Za-z]/.test(source[end] as string)) end += 1
  const raw = source.slice(start, end)
  const operator = OPERATORS.get(raw)

  if (operator) {
    return { end, operator, raw, start, type: TokenType.Operator, value: raw }
  }

  diagnostics.push({
    end,
    message: `Unknown operator ${JSON.stringify(raw)}`,
    start,
  })
  return { end, raw, start, type: TokenType.Unknown, value: raw }
}

/**
 * Read a number token.
 * @param source - Query source.
 * @param start - Number offset.
 * @param diagnostics - Diagnostic sink.
 * @returns The number or unknown token.
 */
function numberToken(source: string, start: number, diagnostics: QueryDiagnostic[]): Token {
  let end = start
  if (source[end] === '-') end += 1
  while (end < source.length && /[0-9]/.test(source[end] as string)) end += 1
  if (source[end] === '.') {
    end += 1
    while (end < source.length && /[0-9]/.test(source[end] as string)) end += 1
  }
  if (source[end] === 'e' || source[end] === 'E') {
    end += 1
    if (source[end] === '+' || source[end] === '-') end += 1
    while (end < source.length && /[0-9]/.test(source[end] as string)) end += 1
  }

  const raw = source.slice(start, end)
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
    return { end, raw, start, type: TokenType.Number, value: raw }
  }

  diagnostics.push({
    end,
    message: `Invalid number literal ${JSON.stringify(raw)}`,
    start,
  })
  return { end, raw, start, type: TokenType.Unknown, value: raw }
}

/**
 * Read a symbolic comparison operator token.
 * @param source - Query source.
 * @param start - Operator offset.
 * @param diagnostics - Diagnostic sink.
 * @returns The operator or unknown token.
 */
function symbolicOperatorToken(
  source: string,
  start: number,
  diagnostics: QueryDiagnostic[],
): Token {
  let end = start + 1
  while (end < source.length && /[=<>!]/.test(source[end] as string)) end += 1
  const raw = source.slice(start, end)
  const operator = OPERATORS.get(raw)

  if (operator) {
    return { end, operator, raw, start, type: TokenType.Operator, value: raw }
  }

  diagnostics.push({
    end,
    message: `Unsupported operator ${JSON.stringify(raw)}`,
    start,
  })
  return { end, raw, start, type: TokenType.Unknown, value: raw }
}

/**
 * Read a field path or keyword token.
 * @param source - Query source.
 * @param start - Identifier offset.
 * @param diagnostics - Diagnostic sink.
 * @returns The field or keyword token.
 */
function fieldToken(source: string, start: number, diagnostics: QueryDiagnostic[]): Token {
  let end = start + 1
  while (end < source.length && IDENTIFIER_PART.test(source[end] as string)) end += 1

  let dotted = false
  while (source[end] === '.') {
    if (!IDENTIFIER_START.test(source[end + 1] ?? '')) {
      diagnostics.push({
        end: end + 1,
        message: 'Expected a field name after "."',
        start: end,
      })
      break
    }
    dotted = true
    end += 2
    while (end < source.length && IDENTIFIER_PART.test(source[end] as string)) end += 1
  }

  const raw = source.slice(start, end)
  if (!dotted) {
    if (raw === 'true' || raw === 'false') {
      return { end, raw, start, type: TokenType.Boolean, value: raw === 'true' }
    }
    if (raw === 'null') return { end, raw, start, type: TokenType.Null, value: null }
  }

  return { end, raw, start, type: TokenType.Field, value: raw }
}
