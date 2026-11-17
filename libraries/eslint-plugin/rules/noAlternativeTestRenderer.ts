/**
 * Bans alternative test renderers.
 *
 * Basis tests mount components with `render`, drive them with `Simulate`, and
 * await updates with `waitFor` from `basis/testing`.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import type { ResolvedReference } from './imports'
import { exportPath, normalizeSource, resolveReference } from './imports'

const TESTING_LIBRARY_PREFIX = '@testing-library/'

const ALTERNATIVE_SOURCES: readonly string[] = [
  'enzyme',
  'react-dom/test-utils',
  'react-test-renderer',
]

const ENZYME_PACKAGE = /^enzyme(?:-|$)/

const REACT_DOM_METHODS: ReadonlySet<string> = new Set(['createRoot', 'hydrate', 'render'])

// Whether a reference names an alternative renderer API.
const isAlternativeRenderer = (reference: ResolvedReference | null): boolean => {
  if (!reference || reference.origin.kind !== 'module') return false
  const source = normalizeSource(reference.origin.source)
  if (source.startsWith(TESTING_LIBRARY_PREFIX)) return true
  if (ALTERNATIVE_SOURCES.includes(source)) return true
  if (ENZYME_PACKAGE.test(source)) return true

  const path = exportPath(reference)
  if (source === 'react-dom/client') return true
  if (source !== 'react-dom') return false
  const [name] = path
  return path.length === 1 && name !== undefined && REACT_DOM_METHODS.has(name)
}

export const noAlternativeTestRenderer: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const report = (node: ESTree.Node): void => {
      context.report({ messageId: 'noAlternativeTestRenderer', node })
    }

    const check = (node: ESTree.CallExpression | ESTree.NewExpression): void => {
      if (isAlternativeRenderer(resolveReference(context, node.callee))) report(node)
    }

    return {
      CallExpression: check,
      NewExpression: check,
    }
  },
  meta: {
    docs: {
      description: 'Require the Basis testing renderer instead of an alternative renderer.',
    },
    messages: {
      noAlternativeTestRenderer: [
        'Alternative test renderers are not allowed.',
        ' Use `render`, `Simulate`, and `waitFor` from `basis/testing` instead.',
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
