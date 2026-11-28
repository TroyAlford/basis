/**
 * Bans committed database writes in tests.
 *
 * Consumer tests use `withDatabase` from `basis/testing`. Its work runs inside
 * one auto-rollback transaction on the single run-scoped fixture. Durable or
 * committed-write helpers are internal lifecycle proofs, not consumer APIs.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { exportPath, resolveReference } from './imports'

const COMMITTED_HELPERS: ReadonlySet<string> = new Set([
  'withCommittedDatabase',
  'withDurableDatabase',
])

export const noCommittedTestDatabaseWrite: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      CallExpression(node: ESTree.CallExpression) {
        const reference = resolveReference(context, node.callee)
        if (!reference) return
        const path = exportPath(reference)
        const name = path[path.length - 1]
        if (name === undefined || !COMMITTED_HELPERS.has(name)) return
        context.report({
          data: { helper: name },
          messageId: 'noCommittedTestDatabaseWrite',
          node,
        })
      },
    }
  },
  meta: {
    docs: {
      description: 'Require auto-rollback database tests instead of committed writes.',
    },
    messages: {
      noCommittedTestDatabaseWrite: [
        'Committed database writes through `{{helper}}` are not allowed in tests.',
        ' Use `withDatabase` from `basis/testing`; its test transaction always rolls back.',
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
