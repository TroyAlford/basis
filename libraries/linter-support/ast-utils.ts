import { isParenthesized } from '@eslint-community/eslint-utils'
import { AST_TOKEN_TYPES } from './ast'

/** A token as seen by an ESLint rule. */
interface Token {
  /** The ESTree token type. */
  type: string,
  /** The token text. */
  value: string,
}

/**
 * Whether a token opens a parenthesized expression.
 * @param token - The token to test.
 * @returns Whether the token is an opening parenthesis.
 */
export const isOpeningParenToken = (token: Token): boolean => (
  token.type === AST_TOKEN_TYPES.Punctuator && token.value === '('
)

/**
 * Whether a token closes a parenthesized expression.
 * @param token - The token to test.
 * @returns Whether the token is a closing parenthesis.
 */
export const isClosingParenToken = (token: Token): boolean => (
  token.type === AST_TOKEN_TYPES.Punctuator && token.value === ')'
)

export { isParenthesized }
