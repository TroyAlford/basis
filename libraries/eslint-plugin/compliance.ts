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
 * Basis's own implementation and lifecycle-test paths.
 *
 * Basis follows its own rules. These are the canonical implementations of the
 * replacement mechanisms themselves, plus the tests whose subject is the test
 * lifecycle surface. The list is explicit: a consumer cannot opt out merely by
 * naming a file `*.lifecycle.*` or putting it in a `testing` directory.
 */
const BASIS_SELF_EXEMPTIONS = [
  'consumer/test/react-runtime.ts',
  'consumer/testing-bun.ts',
  'consumer/testing.ts',
  'libraries/react/testing/render.tsx',
  'libraries/server/source/DatabaseFixture.lifecycle.e2e.ts',
  'libraries/server/source/Migration.e2e.ts',
  'libraries/server/source/Release.e2e.ts',
  'libraries/server/source/ReleaseRecovery.e2e.ts',
  'libraries/server/source/Server.test.ts',
  'libraries/server/testing/DatabaseFixture.ts',
  'libraries/server/testing/DatabaseIsolation.ts',
  'libraries/server/testing/DatabaseSeed.ts',
  'libraries/testing/application.hmr.e2e.ts',
  'libraries/testing/application.lifecycle.test.ts',
  'libraries/testing/application.ts',
  'libraries/testing/browser.ts',
  'libraries/testing/bun.ts',
  'libraries/testing/cleanup.test.ts',
  'libraries/testing/lanes.test.ts',
  'libraries/testing/lifecycle.ts',
  'libraries/testing/matchScreenshot.baseline.test.ts',
  'libraries/testing/matchScreenshot.ts',
  'libraries/testing/runtime.lifecycle.e2e.ts',
  'libraries/testing/snapshots.test.ts',
  'libraries/testing/snapshots.ts',
  'libraries/testing/temp.test.ts',
  'libraries/testing/temp.ts',
  'libraries/utilities/functions/run.ts',
  'server.test.ts',
  'testing/components/Stage.tsx',
  'testing/e2e/main.tsx',
  'testing/server/Application.tsx',
  'testing/server/WithAsset.tsx',
  'testing/walkthrough/Application.tsx',
  'testing/**/serve.ts',
]

/**
 * Builds the authoritative Basis paradigm policy used by `basis compliance`.
 *
 * Compliance runs the same style and typecheck surface as `basis lint`, plus
 * every architecture and infrastructure opinion: components are class-based,
 * process execution goes through the Basis runner, and consumer test
 * infrastructure uses the Basis fixtures. Formatting rules stay in `basis lint`;
 * this configuration is the paradigm gate.
 * @returns A flat ESLint configuration array.
 */
export const createComplianceConfig = (): Linter.Config[] => ([
  { ignores: [...IGNORE_PATTERNS, ...BASIS_SELF_EXEMPTIONS] },
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
