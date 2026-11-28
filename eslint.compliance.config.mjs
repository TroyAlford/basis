import { resolve, sep } from 'node:path'
import process from 'node:process'
import { createComplianceConfig } from './libraries/linter-typescript/compliance'

/*
 * Basis follows its own compliance policy. These are the only repository-local
 * exceptions, and they are scoped to one rule and one exact file. A new
 * violation of any other rule in one of these files is still reported.
 *
 * The shared compliance factory contains no repository exceptions. This file
 * only applies them when ESLint runs inside the Basis repository itself, so a
 * consumer never inherits a Basis-internal path allowance.
 */
const RULE_ALLOWANCES = {
  '@basis/no-alternative-screenshots': [
    'libraries/testing/matchScreenshot.baseline.test.ts',
    'libraries/testing/matchScreenshot.ts',
    'libraries/testing/snapshots.test.ts',
    'libraries/testing/snapshots.ts',
  ],
  '@basis/no-alternative-test-renderer': [
    'libraries/react/testing/render.tsx',
    'testing/components/Stage.tsx',
    'testing/e2e/main.tsx',
    'testing/server/Application.tsx',
    'testing/server/WithAsset.tsx',
    'testing/walkthrough/Application.tsx',
  ],
  '@basis/no-committed-test-database-write': [
    'libraries/server/source/ConstraintValidation.e2e.ts',
    'libraries/server/source/CreateAuthorization.e2e.ts',
    'libraries/server/source/Database.e2e.ts',
    'libraries/server/source/Mutation.e2e.ts',
  ],
  '@basis/no-custom-database-fixture': [
    'libraries/server/source/ReleaseRecovery.e2e.ts',
    'libraries/server/testing/DatabaseFixture.ts',
  ],
  '@basis/no-custom-test-lifecycle': [
    'libraries/server/source/Server.test.ts',
    'libraries/server/testing/DatabaseFixture.ts',
    'libraries/testing/bun.ts',
  ],
  '@basis/no-custom-test-server': [
    'consumer/test/react-runtime.ts',
    'libraries/server/source/Authorization.e2e.ts',
    'libraries/server/source/DatabaseFixture.lifecycle.e2e.ts',
    'libraries/server/source/DatabaseInstall.e2e.ts',
    'libraries/server/source/PostgresOperations.e2e.ts',
    'libraries/server/source/Readiness.e2e.ts',
    'libraries/server/source/RequestContext.e2e.ts',
    'libraries/server/source/Release.e2e.ts',
    'libraries/server/source/ReleaseRecovery.e2e.ts',
    'libraries/testing/application.ts',
    'testing/components/serve.ts',
    'testing/docs/serve.ts',
  ],
  '@basis/no-custom-test-temp-root': [
    'libraries/testing/tempDirectory.test.ts',
    'libraries/testing/tempDirectory.ts',
  ],
  '@basis/no-direct-application-navigation': [
    'libraries/testing/application.ts',
  ],
  '@basis/no-direct-process-spawn': [
    'consumer/test/react-runtime.ts',
    'libraries/server/source/DatabaseFixture.lifecycle.e2e.ts',
    'libraries/testing/application.lifecycle.test.ts',
    'libraries/testing/application.ts',
    'libraries/utilities/functions/run.ts',
  ],
  '@basis/no-direct-testing-internals': [
    'consumer/testing-bun.ts',
    'consumer/testing.ts',
  ],
  '@basis/no-test-database-isolation-framework': [
    'libraries/server/source/Migration.e2e.ts',
    'libraries/server/source/Release.e2e.ts',
    'libraries/server/testing/DatabaseFixture.ts',
    'libraries/server/testing/DatabaseLifecycle.ts',
    'libraries/server/testing/DatabaseSeed.ts',
  ],
}

const repoRoot = resolve(import.meta.dir)
const workingDirectory = resolve(process.cwd())
const isBasisRepository = workingDirectory === repoRoot
  || workingDirectory.startsWith(`${repoRoot}${sep}`)

const allowances = Object.entries(RULE_ALLOWANCES).map(([rule, files]) => ({
  files,
  rules: { [rule]: 'off' },
}))

export default [
  { ignores: ['**/.basis/**'] },
  ...createComplianceConfig(),
  ...(isBasisRepository ? allowances : []),
]
