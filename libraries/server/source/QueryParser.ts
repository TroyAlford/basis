import { Operator } from './Operator'
import type { QueryDiagnostic, Token } from './QueryLexer'
import { QueryLexer, TokenType } from './QueryLexer'

/** Literal categories retained from source syntax. */
export type QueryLiteralKind = 'boolean' | 'null' | 'number' | 'string'

/**
 * A transient syntax literal.
 *
 * Numbers retain their exact source spelling; canonical typed values are built
 * later at the field-aware normalization boundary.
 */
export interface QueryLiteral {
  /** Exclusive source offset. */
  readonly end: number,
  /** Literal category. */
  readonly kind: QueryLiteralKind,
  /** Exact source spelling. */
  readonly raw: string,
  /** Inclusive source offset. */
  readonly start: number,
  /** Decoded string or boolean, null for null, and raw spelling for numbers. */
  readonly value: string | boolean | null,
}

/** A transient field comparison expression. */
export interface QueryComparison {
  /** Exclusive source offset. */
  readonly end: number,
  /** Root entity field name. */
  readonly field: string,
  /** Syntax node discriminator. */
  readonly kind: 'comparison',
  /** Comparison operator identity. */
  readonly operator: Operator.Comparison,
  /** Inclusive source offset. */
  readonly start: number,
  /**
   * Source argument literals in order.
   *
   * Comparisons have one value, `Between` has exactly two bounds, and `Empty`
   * has none.
   */
  readonly values: readonly QueryLiteral[],
}

/** A transient logical expression. */
export interface QueryLogical {
  /** Exclusive source offset. */
  readonly end: number,
  /** Child expressions. */
  readonly filters: readonly QueryExpression[],
  /** Syntax node discriminator. */
  readonly kind: 'logical',
  /** Logical operator identity. */
  readonly operator: Operator.Logical,
  /** Inclusive source offset. */
  readonly start: number,
}

/** An explicitly parenthesized expression, including its delimiters. */
export interface QueryGroup {
  /** Exclusive source offset. */
  readonly end: number,
  /** Grouped expression. */
  readonly expression: QueryExpression,
  /** Syntax node discriminator. */
  readonly kind: 'group',
  /** Inclusive source offset. */
  readonly start: number,
}

/** A non-executable query syntax expression. */
export type QueryExpression = QueryComparison | QueryLogical | QueryGroup

/** The bounds parsed from a bracketed range. */
interface ParsedBetween {
  /** Exclusive source offset after the closing bracket. */
  readonly end: number,
  /** Lower and upper bound literals. */
  readonly values: readonly QueryLiteral[],
}

/** A parsed query expression and its diagnostics. */
export interface QueryParseResult {
  /** Lexer and parser diagnostics in source order. */
  readonly diagnostics: readonly QueryDiagnostic[],
  /** The transient syntax tree, or null for empty, failed, or incomplete input. */
  readonly expression: QueryExpression | null,
  /** Lexer tokens consumed by the parser. */
  readonly tokens: readonly Token[],
}

/**
 * Parse a string query expression into a transient syntax tree.
 *
 * Parsing is deliberately separate from entity validation, literal typing, and
 * SQL execution. Any lexer or parser diagnostic suppresses the expression while
 * retaining diagnostics and tokens for editor highlighting.
 */
export const QueryParser = {
  /**
   * Parse query source.
   * @param source - Query expression source.
   * @returns The syntax expression and all diagnostics.
   */
  parse(source: string): QueryParseResult {
    const lexed = QueryLexer.tokenize(source)
    const parser = new Parser(lexed.tokens, lexed.diagnostics)
    const expression = parser.parse()
    const diagnostics = [...parser.diagnostics].sort((left, right) => (
      left.start - right.start || left.end - right.end
    ))
    return {
      diagnostics,
      expression: diagnostics.length === 0 ? expression : null,
      tokens: lexed.tokens,
    }
  },
}

/** Parser state for one token stream. */
class Parser {
  readonly diagnostics: QueryDiagnostic[]
  #index = 0

  /**
   * Create a parser over lexer tokens.
   * @param tokens - Tokens ending in EOF.
   * @param diagnostics - Lexer diagnostics to preserve.
   */
  constructor(
    private readonly tokens: readonly Token[],
    diagnostics: readonly QueryDiagnostic[],
  ) {
    this.diagnostics = [...diagnostics]
  }

  /**
   * Parse the complete expression.
   * @returns The syntax expression, or null on failure/empty input.
   */
  parse(): QueryExpression | null {
    if (this.#peek().type === TokenType.EOF) return null
    const expression = this.#parseOr()
    if (!expression) return null
    if (this.#peek().type !== TokenType.EOF) {
      this.#error('Unexpected token after expression', this.#peek())
      return null
    }
    return expression
  }

  /**
   * Parse OR-separated expressions.
   * @returns The combined expression, or null on failure.
   */
  #parseOr(): QueryExpression | null {
    const filters: QueryExpression[] = []
    const first = this.#parseAnd()
    if (!first) return null
    filters.push(first)
    while (this.#matchOperator(Operator.Logical.Or)) {
      const right = this.#parseAnd()
      if (!right) return null
      filters.push(right)
    }
    if (filters.length === 1) return first
    return logical(Operator.Logical.Or, filters, first.start, (filters.at(-1) as QueryExpression).end)
  }

  /**
   * Parse AND-separated expressions.
   * @returns The combined expression, or null on failure.
   */
  #parseAnd(): QueryExpression | null {
    const filters: QueryExpression[] = []
    const first = this.#parsePrimary()
    if (!first) return null
    filters.push(first)
    while (this.#matchOperator(Operator.Logical.And)) {
      const right = this.#parsePrimary()
      if (!right) return null
      filters.push(right)
    }
    if (filters.length === 1) return first
    return logical(Operator.Logical.And, filters, first.start, (filters.at(-1) as QueryExpression).end)
  }

  /**
   * Parse a grouping, unary negation, or field expression.
   * @returns The parsed expression, or null on failure.
   */
  #parsePrimary(): QueryExpression | null {
    const not = this.#matchOperator(Operator.Logical.Not)
    if (not) {
      const operand = this.#parsePrimary()
      return operand ? logical(Operator.Logical.Not, [operand], not.start, operand.end) : null
    }
    if (this.#peek().type === TokenType.LeftParen) {
      const opening = this.#peek()
      this.#index += 1
      const grouped = this.#parseOr()
      if (!grouped) return null
      const closing = this.#expect(TokenType.RightParen, 'Expected ")" after grouped expression')
      if (!closing) return null
      return { end: closing.end, expression: grouped, kind: 'group', start: opening.start }
    }
    return this.#parseField()
  }

  /**
   * Parse one field expression.
   * @returns The parsed expression, or null on failure.
   */
  #parseField(): QueryExpression | null {
    const field = this.#expect(TokenType.Field, 'Expected a field name')
    if (!field) return null

    let negations = 0
    while (this.#matchOperator(Operator.Logical.Not)) negations += 1
    const token = this.#expect(TokenType.Operator, 'Expected an operator after field')
    if (!token || !token.operator) return null
    const operator = token.operator as Operator.Comparison | Operator.Logical

    if (operator === Operator.Logical.And || operator === Operator.Logical.Or || operator === Operator.Logical.Not) {
      this.#error(`Unexpected logical operator ${JSON.stringify(token.raw)}`, token)
      return null
    }

    let end: number
    let values: readonly QueryLiteral[]
    if (operator === Operator.Comparison.Between) {
      const bounds = this.#parseBetween()
      if (!bounds) return null
      end = bounds.end
      values = bounds.values
    } else if (operator === Operator.Comparison.Empty) {
      end = token.end
      values = []
    } else {
      const value = this.#parseLiteral()
      if (!value) return null
      end = value.end
      values = [value]
    }

    let expression: QueryExpression = {
      end,
      field: field.value as string,
      kind: 'comparison',
      operator,
      start: field.start,
      values,
    }
    for (let count = 0; count < negations; count += 1) {
      expression = logical(Operator.Logical.Not, [expression], expression.start, expression.end)
    }
    return expression
  }

  /**
   * Parse a bracketed inclusive range.
   * @returns The two bounds and end offset, or null on failure.
   */
  #parseBetween(): ParsedBetween | null {
    if (!this.#expect(TokenType.LeftBracket, 'Expected "[" after $between')) return null
    const lower = this.#parseLiteral()
    if (!lower) return null
    if (!this.#expect(TokenType.Comma, 'Expected "," between range bounds')) return null
    const upper = this.#parseLiteral()
    if (!upper) return null
    const closing = this.#expect(TokenType.RightBracket, 'Expected "]" after range bounds')
    if (!closing) return null

    if (lower.kind === 'null' && upper.kind === 'null') {
      this.#error('Between requires at least one non-null bound', closing)
      return null
    }
    return { end: closing.end, values: [lower, upper] }
  }

  /**
   * Parse one syntax literal.
   * @returns The literal, or undefined on failure.
   */
  #parseLiteral(): QueryLiteral | undefined {
    const token = this.#peek()
    switch (token.type) {
      case TokenType.Boolean:
        this.#index += 1
        return {
          end: token.end,
          kind: 'boolean',
          raw: token.raw,
          start: token.start,
          value: token.value as boolean,
        }
      case TokenType.Null:
        this.#index += 1
        return {
          end: token.end,
          kind: 'null',
          raw: token.raw,
          start: token.start,
          value: null,
        }
      case TokenType.Number:
        this.#index += 1
        return {
          end: token.end,
          kind: 'number',
          raw: token.raw,
          start: token.start,
          value: token.value as string,
        }
      case TokenType.String:
        this.#index += 1
        return {
          end: token.end,
          kind: 'string',
          raw: token.raw,
          start: token.start,
          value: token.value as string,
        }
      default:
        this.#error('Expected a literal value', token)
        return undefined
    }
  }

  /**
   * Return the current token.
   * @returns The current token.
   */
  #peek(): Token {
    return this.tokens[this.#index] as Token
  }

  /**
   * Consume a token type.
   * @param type - Expected token type.
   * @param message - Diagnostic when absent.
   * @returns The token, or null on failure.
   */
  #expect(type: TokenType, message: string): Token | null {
    const token = this.#peek()
    if (token.type === type) {
      this.#index += 1
      return token
    }
    this.#error(message, token)
    return null
  }

  /**
   * Consume a matching operator.
   * @param operator - Operator identity to match.
   * @returns The consumed token, or null when absent.
   */
  #matchOperator(operator: Operator.Comparison | Operator.Logical): Token | null {
    const token = this.#peek()
    if (token.type === TokenType.Operator && token.operator === operator) {
      this.#index += 1
      return token
    }
    return null
  }

  /**
   * Add a span-specific diagnostic.
   * @param message - Diagnostic message.
   * @param token - Offending token.
   */
  #error(message: string, token: Token): void {
    this.diagnostics.push({ end: token.end, message, start: token.start })
  }
}

/**
 * Build a transient logical expression.
 * @param operator - Logical operator identity.
 * @param filters - Child expressions.
 * @param start - Inclusive source offset.
 * @param end - Exclusive source offset.
 * @returns The logical syntax expression.
 */
function logical(
  operator: Operator.Logical,
  filters: readonly QueryExpression[],
  start: number,
  end: number,
): QueryLogical {
  return { end, filters, kind: 'logical', operator, start }
}
