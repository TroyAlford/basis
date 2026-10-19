/**
 * A runtime-only replacement for `@typescript-eslint/utils`.
 *
 * The real package declares a TypeScript peer that installs the compiler even
 * when only its AST constants and small ESLint helpers are used. Basis uses
 * those helpers from JavaScript rules, so this workspace provides the same
 * runtime surface without the compiler.
 */
export * from '@typescript-eslint/types'
export * as ASTUtils from './ast-utils'
export * as ESLintUtils from './eslint-utils'
