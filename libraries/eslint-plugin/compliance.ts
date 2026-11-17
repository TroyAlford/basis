import type { Linter } from 'eslint'
import pluginTypescript from 'typescript-eslint'
import { IGNORE_PATTERNS } from './ignores'
import { plugins } from './plugins'

/**
 * Test-lane paths that receive the testing and infrastructure rules.
 *
 * These are the repository's established test naming and directory patterns.
 * Application source only receives the architecture and process rules.
 */
const TEST_FILES = [
  '**/*.{e2e,screenshot,spec,test}.{js,jsx,ts,tsx}',
  '**/{__fixtures__,__tests__,fixtures,test,tests,testing}/**/*.{js,jsx,ts,tsx}',
]

/**
 * Builds the authoritative Basis paradigm policy used by `basis compliance`.
 *
 * Compliance runs the same style and typecheck surface as `basis lint`, plus
 * every architecture and infrastructure opinion: components are class-based,
 * process execution goes through the Basis runner, and consumer test
 * infrastructure uses the Basis fixtures. Formatting rules stay in `basis lint`;
 * this configuration is the paradigm gate.
 *
 * This factory is the shared policy and contains no repository-specific
 * exceptions. Basis's own implementation and lifecycle paths receive narrow,
 * per-rule exceptions in the repository's `eslint.compliance.config.mjs`, so a
 * new violation in an excepted file is still reported.
 * @returns A flat ESLint configuration array.
 */
export const createComplianceConfig = (): Linter.Config[] => ([
  { ignores: [...IGNORE_PATTERNS] },
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
      '@basis/no-direct-process-spawn': 'error',
      '@basis/no-direct-testing-internals': 'error',
    },
  },
  {
    files: TEST_FILES,
    plugins: {
      ...plugins,
    },
    rules: {
      '@basis/no-alternative-screenshots': 'error',
      '@basis/no-alternative-test-renderer': 'error',
      '@basis/no-custom-database-fixture': 'error',
      '@basis/no-custom-test-lifecycle': 'error',
      '@basis/no-custom-test-server': 'error',
      '@basis/no-custom-test-temp-root': 'error',
      '@basis/no-direct-browser-lifecycle': 'error',
      '@basis/no-test-database-isolation-framework': 'error',
    },
  },
]) as unknown as Linter.Config[]
