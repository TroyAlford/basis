import * as parser from '@typescript-eslint/parser'
import type { Rule } from 'eslint'
import { Linter } from 'eslint'

/**
 * Lint one fixture with a single rule.
 * @param rule The rule to register under the `test` plugin.
 * @param code The fixture source.
 * @param filename The fixture path used for scoping and reporting.
 * @returns The lint messages.
 */
export const lintRule = (
  rule: Rule.RuleModule,
  code: string,
  filename = 'fixture.ts',
): Linter.LintMessage[] => new Linter().verify(code, [{
  files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  languageOptions: {
    ecmaVersion: 'latest',
    parser: parser as unknown as Linter.LanguageOptions['parser'],
    parserOptions: {
      ecmaFeatures: { jsx: true },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    sourceType: 'module',
  },
  plugins: {
    test: {
      rules: {
        rule,
      },
    },
  },
  rules: {
    'test/rule': 'error',
  },
}], filename)
