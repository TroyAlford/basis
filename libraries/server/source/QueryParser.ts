import { Operator } from './Operator'
import type { ComparisonFilter, Filter } from './Predicate'
import { Predicate } from './Predicate'
import type { QueryDiagnostic, Token } from './QueryLexer'
import { QueryLexer, TokenType } from './QueryLexer'

/** A parsed query expression and its diagnostics. */
export interface QueryParseResult {
  /** Lexer and parser diagnostics in source order. */
  readonly diagnostics: readonly QueryDiagnostic[],
  /** The normalized filter tree, or null when parsing failed or input was empty. */
  readonly filter: Filter | null,
  /** Lexer tokens consumed by the parser. */
  readonly tokens: readonly Token[],
}

/**
 * Parse a string query expression into the canonical filter tree.
 *
 * Parsing is deliberately separate from entity validation and SQL execution.
 * Invalid or incomplete input returns diagnostics instead of throwing.
 */
export const QueryParser = {
  /**
   * Parse query source.
   * @param source - Query expression source.
   * @returns The normalized filter and all diagnostics.
   */
  parse(source: string): QueryParseResult {
    const lexed = QueryLexer.tokenize(source)
    const parser = new Parser(lexed.tokens, lexed.diagnostics)
    const filter = parser.parse()
    const diagnostics = [...parser.diagnostics].sort((left, right) => (
      left.start - right.start || left.end - right.end
    ))
    return {
      diagnostics,
      filter: diagnostics.length === 0 ? filter : null,
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
   * @returns The normalized filter, or null on failure/empty input.
   */
  parse(): Filter | null {
    if (this.#peek().type === TokenType.EOF) return null
    const filter = this.#parseOr()
    if (!filter) return null
    if (this.#peek().type !== TokenType.EOF) {
      this.#error('Unexpected token after expression', this.#peek())
      return null
    }
    return filter
  }

  /**
   * Parse OR-separated expressions.
   * @returns The combined filter, or null on failure.
   */
  #parseOr(): Filter | null {
    const filters: Filter[] = []
    const first = this.#parseAnd()
    if (!first) return null
    filters.push(first)
    while (this.#matchOperator(Operator.Logical.Or)) {
      const right = this.#parseAnd()
      if (!right) return null
      filters.push(right)
    }
    return filters.length === 1 ? first : Predicate.logical(Operator.Logical.Or, filters)
  }

  /**
   * Parse AND-separated expressions.
   * @returns The combined filter, or null on failure.
   */
  #parseAnd(): Filter | null {
    const filters: Filter[] = []
    const first = this.#parsePrimary()
    if (!first) return null
    filters.push(first)
    while (this.#matchOperator(Operator.Logical.And)) {
      const right = this.#parsePrimary()
      if (!right) return null
      filters.push(right)
    }
    return filters.length === 1 ? first : Predicate.logical(Operator.Logical.And, filters)
  }

  /**
   * Parse a grouping, unary negation, or field expression.
   * @returns The parsed filter, or null on failure.
   */
  #parsePrimary(): Filter | null {
    if (this.#matchOperator(Operator.Logical.Not)) {
      const operand = this.#parsePrimary()
      return operand ? Predicate.not(operand) : null
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
   * Parse one field predicate.
   * @returns The parsed filter, or null on failure.
   */
  #parseField(): Filter | null {
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

    let filter: Filter
    if (operator === Operator.Comparison.Between) {
      filter = this.#parseBetween(field.value as string)
      if (!filter) return null
    } else if (operator === Operator.Comparison.Empty) {
      filter = Predicate.empty(field.value as string)
    } else {
      const value = this.#parseLiteral()
      if (value === undefined) return null
      const comparison: ComparisonFilter = {
        field: field.value as string,
        operator,
        value,
      }
      filter = operator === Operator.Comparison.NotEqual
        ? Predicate.notEqual(comparison.field, comparison.value)
        : comparison
    }

    for (let count = 0; count < negations; count += 1) filter = Predicate.not(filter)
    return filter
  }

  /**
   * Parse a bracketed inclusive range.
   * @param field - Field name.
   * @returns The range filter, or null on failure.
   */
  #parseBetween(field: string): Filter | null {
    if (!this.#expect(TokenType.LeftBracket, 'Expected "[" after $between')) return null
    const lower = this.#parseBound()
    if (lower === undefined) return null
    if (!this.#expect(TokenType.Comma, 'Expected "," between range bounds')) return null
    const upper = this.#parseBound()
    if (upper === undefined) return null
    const closing = this.#expect(TokenType.RightBracket, 'Expected "]" after range bounds')
    if (!closing) return null

    if (lower === null && upper === null) {
      this.#error('Between requires at least one non-null bound', closing)
      return null
    }
    return Predicate.between(field, lower, upper)
  }

  /**
   * Parse a range bound, allowing null.
   * @returns The parsed bound, or undefined on failure.
   */
  #parseBound(): unknown {
    const token = this.#peek()
    if (token.type === TokenType.Null) {
      this.#index += 1
      return null
    }
    return this.#parseLiteral()
  }

  /**
   * Parse one scalar literal.
   *
   * Integer spellings become `bigint` so Snowflake precision survives parsing;
   * decimal and exponent spellings become finite `number` values.
   * @returns The parsed value, or undefined on failure.
   */
  #parseLiteral(): unknown {
    const token = this.#peek()
    switch (token.type) {
      case TokenType.Boolean:
      case TokenType.Null:
      case TokenType.String:
        this.#index += 1
        return token.value
      case TokenType.Number: {
        this.#index += 1
        const raw = token.value as string
        if (/^-?\d+$/.test(raw)) return BigInt(raw)
        const value = Number(raw)
        if (!Number.isFinite(value)) {
          this.#error('Number literal is out of range', token)
          return undefined
        }
        return value
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
