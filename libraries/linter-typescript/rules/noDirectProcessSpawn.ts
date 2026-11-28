/**
 * Bans direct process execution outside the Basis command runner.
 *
 * `run` and `runAsync` from `basis/utilities` are the only one-shot process
 * execution helpers. They capture output, never invoke a shell, and report
 * through the Basis logger. Direct `Bun.spawn`, Node `child_process`, and
 * common wrappers duplicate that behavior and are not allowed.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { exportPath, fromSource, resolveReference } from './imports'
import { describeProcess, isProcessExecution } from './processes'

// Whether a call is `promisify` or `util.promisify`.
const isPromisify = (reference: ReturnType<typeof resolveReference>): boolean => {
  if (!reference) return false
  const path = exportPath(reference)
  return fromSource(reference, ['util']) && path.length === 1 && path[0] === 'promisify'
}

export const noDirectProcessSpawn: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const report = (node: ESTree.Node, api: string): void => {
      context.report({
        data: { api },
        messageId: 'noDirectProcessSpawn',
        node,
      })
    }

    const check = (node: ESTree.Node, reference: ReturnType<typeof resolveReference>): void => {
      if (isProcessExecution(reference) && reference) report(node, describeProcess(reference))
    }

    return {
      CallExpression(node: ESTree.CallExpression) {
        const reference = resolveReference(context, node.callee)
        check(node, reference)

        if (isPromisify(reference)) {
          for (const argument of node.arguments) {
            const argumentReference = resolveReference(context, argument)
            if (isProcessExecution(argumentReference) && argumentReference) {
              report(node, describeProcess(argumentReference))
            }
          }
        }
      },
      TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression) {
        check(node, resolveReference(context, node.tag))
      },
    }
  },
  meta: {
    docs: {
      description: 'Require the Basis command runner instead of direct process execution.',
    },
    messages: {
      noDirectProcessSpawn: [
        'Direct process execution through "{{api}}" is not allowed.',
        ' Use `run` or `runAsync` from `basis/utilities` instead.',
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
