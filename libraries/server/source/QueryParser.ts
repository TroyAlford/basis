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
  /** Literal category. */
  readonly kind: QueryLiteralKind,
  /** Exact source spelling. */
  readonly raw: string,
  /** Decoded string or boolean, null for null, and raw spelling for numbers. */
  readonly value: string | boolean | null,
}

/** A transient field comparison expression. */
export interface QueryComparison {
  /** Root entity field name. */
  readonly field: string,
  /** Syntax node discriminator. */
  readonly kind: 'comparison',
  /** Comparison operator identity. */
  readonly operator: Operator.Comparison,
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
  /** Child expressions. */
  readonly filters: readonly QueryExpression[],
  /** Syntax node discriminator. */
  readonly kind: 'logical',
  /** Logical operator identity. */
  readonly operator: Operator.Logical,
}

/** A non-executable query syntax expression. */
export type QueryExpression = QueryComparison | QueryLogical

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
    return filters.length === 1 ? first : logical(Operator.Logical.Or, filters)
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
    return filters.length === 1 ? first : logical(Operator.Logical.And, filters)
  }

  /**
   * Parse a grouping, unary negation, or field expression.
   * @returns The parsed expression, or null on failure.
   */
  #parsePrimary(): QueryExpression | null {
    if (this.#matchOperator(Operator.Logical.Not)) {
      const operand = this.#parsePrimary()
      return operand ? logical(Operator.Logical.Not, [operand]) : null
    }
    if (this.#peek().type === TokenType.LeftParen) {
      this.#index += 1
      const grouped = this.#parseOr()
      if (!grouped) return null
      if (!this.#expect(TokenType.RightParen, 'Expected ")" after grouped expression')) return null
      return grouped
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

    let values: readonly QueryLiteral[]
    if (operator === Operator.Comparison.Between) {
      const bounds = this.#parseBetween()
      if (!bounds) return null
      values = bounds
    } else if (operator === Operator.Comparison.Empty) {
      values = []
    } else {
      const value = this.#parseLiteral()
      if (!value) return null
      values = [value]
    }

    let expression: QueryExpression = {
      field: field.value as string,
      kind: 'comparison',
      operator,
      values,
    }
    for (let count = 0; count < negations; count += 1) {
      expression = logical(Operator.Logical.Not, [expression])
    }
    return expression
  }

  /**
   * Parse a bracketed inclusive range.
   * @returns The two bound literals, or null on failure.
   */
  #parseBetween(): readonly QueryLiteral[] | null {
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
    return [lower, upper]
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
        return { kind: 'boolean', raw: token.raw, value: token.value as boolean }
      case TokenType.Null:
        this.#index += 1
        return { kind: 'null', raw: token.raw, value: null }
      case TokenType.Number:
        this.#index += 1
        return { kind: 'number', raw: token.raw, value: token.value as string }
      case TokenType.String:
        this.#index += 1
        return { kind: 'string', raw: token.raw, value: token.value as string }
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
   * @returns Whether the operator was consumed.
   */
  #matchOperator(operator: Operator.Comparison | Operator.Logical): boolean {
    const token = this.#peek()
    if (token.type === TokenType.Operator && token.operator === operator) {
      this.#index += 1
      return true
    }
    return false
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
 * @returns The logical syntax expression.
 */
function logical(
  operator: Operator.Logical,
  filters: readonly QueryExpression[],
): QueryLogical {
  return { filters, kind: 'logical', operator }
}
