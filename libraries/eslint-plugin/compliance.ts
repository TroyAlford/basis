import type { Linter } from 'eslint'
import pluginTypescript from 'typescript-eslint'
import { IGNORE_PATTERNS } from './ignores'
import { plugins } from './plugins'

/**
 * Builds the focused, report-only architecture configuration used by
 * `basis compliance`.
 *
 * It applies the same `@basis/component-architecture` rule implementation the
 * full `basis/eslint` config uses, so the architecture policy has one source of
 * truth. Formatting, style, and other repository rules are intentionally absent:
 * compliance is the discoverable entry point for the non-formatting
 * architectural contract, not a second lint policy.
 * @returns A flat ESLint configuration array.
 */
export const createComplianceConfig = (): Linter.Config[] => ([
  { ignores: IGNORE_PATTERNS },
  {
    files: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      parser: pluginTypescript.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    plugins: {
      ...plugins,
    },
    rules: {
      '@basis/component-architecture': 'error',
    },
  },
]) as unknown as Linter.Config[]
