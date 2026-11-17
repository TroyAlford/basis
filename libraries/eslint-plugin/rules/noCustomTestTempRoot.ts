/**
 * Bans manual run-wide temporary roots in tests.
 *
 * The Basis preload redirects `os.tmpdir()` to a run-scoped root and removes it
 * at teardown. Tests use `tempDirectory` from `basis/testing` instead of
 * creating or redirecting a temporary root themselves.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import type { ResolvedReference } from './imports'
import { exportPath, fromGlobal, fromSource, resolveReference } from './imports'

const FS_SOURCES: readonly string[] = ['fs', 'fs/promises']

const OS_SOURCES: readonly string[] = ['os']

const TEMP_FUNCTIONS: ReadonlySet<string> = new Set(['mkdtemp', 'mkdtempSync', 'tmpdir'])

const TEMP_ENV_VARS: ReadonlySet<string> = new Set(['TEMP', 'TMP', 'TMPDIR'])

// Whether a reference creates or reads a temporary root.
const isTempRootApi = (reference: ResolvedReference | null): boolean => {
  if (!reference) return false
  if (!fromSource(reference, [...FS_SOURCES, ...OS_SOURCES])) return false
  const path = exportPath(reference)
  const name = path[path.length - 1]
  return name !== undefined && TEMP_FUNCTIONS.has(name)
}

// Whether an assignment rewrites a process-wide temporary root.
const isTempEnvAssignment = (reference: ResolvedReference | null): boolean => {
  if (!reference) return false
  const path = exportPath(reference)
  if (path.length !== 2 || path[0] !== 'env') return false
  const name = path[1]
  if (name === undefined || !TEMP_ENV_VARS.has(name)) return false
  return fromGlobal(reference, ['Bun', 'process'])
}

export const noCustomTestTempRoot: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      AssignmentExpression(node: ESTree.AssignmentExpression) {
        if (isTempEnvAssignment(resolveReference(context, node.left))) {
          context.report({ messageId: 'noCustomTestTempRoot', node })
        }
      },
      CallExpression(node: ESTree.CallExpression) {
        if (isTempRootApi(resolveReference(context, node.callee))) {
          context.report({ messageId: 'noCustomTestTempRoot', node })
        }
      },
    }
  },
  meta: {
    docs: {
      description: 'Require the Basis temporary root instead of manual test temp setup.',
    },
    messages: {
      noCustomTestTempRoot: [
        'Manual run-wide temporary-directory setup or cleanup is not allowed.',
        ' Use `tempDirectory` from `basis/testing`; the Basis preload owns the temporary root and cleanup.',
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
