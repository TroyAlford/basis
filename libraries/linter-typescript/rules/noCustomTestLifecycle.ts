/**
 * Bans manual shared-fixture lifecycle orchestration in tests.
 *
 * The `basis/testing/bun` preload owns the run-scoped application, browser, and
 * database teardown. Tests acquire fixtures per test and never start or stop
 * the shared lifecycle themselves.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import type { ResolvedReference } from './imports'
import { exportPath, fromGlobal, fromSource, literalString, resolveReference } from './imports'

const TESTING_SOURCES: readonly string[] = ['basis/testing', 'basis/testing/bun']

const LIFECYCLE_EXPORTS: ReadonlySet<string> = new Set([
  'registerRunCleanup',
  'startApplication',
  'stopApplications',
])

const EXIT_SIGNALS: ReadonlySet<string> = new Set([
  'SIGBREAK',
  'SIGHUP',
  'SIGINT',
  'SIGTERM',
  'exit',
])

// Whether a reference is a manual shared-lifecycle API.
const isLifecycleApi = (reference: ResolvedReference | null): boolean => {
  if (!reference) return false
  if (!fromSource(reference, TESTING_SOURCES)) return false
  const path = exportPath(reference)
  return path.length === 1 && path[0] !== undefined && LIFECYCLE_EXPORTS.has(path[0])
}

// Whether a call installs an exit-time cleanup listener.
const isExitListener = (reference: ResolvedReference | null, node: ESTree.CallExpression): boolean => {
  if (!reference) return false
  const path = exportPath(reference)
  const [first] = node.arguments
  const signal = literalString(first)
  if (signal === null || !EXIT_SIGNALS.has(signal)) return false
  if (fromGlobal(reference, ['process'])) {
    return path.length === 1 && (path[0] === 'on' || path[0] === 'once')
  }
  if (fromGlobal(reference, ['Bun'])) {
    return path.length === 1 && path[0] === 'addSignalListener'
  }
  return false
}

export const noCustomTestLifecycle: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      CallExpression(node: ESTree.CallExpression) {
        const reference = resolveReference(context, node.callee)
        if (isLifecycleApi(reference) || isExitListener(reference, node)) {
          context.report({ messageId: 'noCustomTestLifecycle', node })
        }
      },
    }
  },
  meta: {
    docs: {
      description: 'Require the Basis test preload to own shared fixture lifecycle.',
    },
    messages: {
      noCustomTestLifecycle: [
        'Manual shared-fixture start/stop orchestration is not allowed.',
        ' Add `basis/testing/bun` to the `[test] preload` list in `bunfig.toml`',
        ' and acquire fixtures per test with `useApplication` and `useDatabaseFixture`.',
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
