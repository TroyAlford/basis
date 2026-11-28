/**
 * Bans imports of Basis testing implementation files.
 *
 * `basis/testing` and `basis/testing/bun` are the supported testing surfaces.
 * Every deeper path couples consumer code to implementation details that are
 * free to change.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'
import { literalString, normalizeSource, resolveReference } from './imports'

const PUBLIC_SOURCES: ReadonlySet<string> = new Set(['basis/testing', 'basis/testing/bun'])

const PRIVATE_WORKSPACE = /^@basis\/testing(?:\/|$)/

const INTERNAL_PATH = /(?:^|\/)(?:basis\/)?libraries\/testing(?:\/|$)/

// Whether a module specifier reaches a private testing implementation.
const isPrivateSource = (source: string): boolean => {
  const normalized = normalizeSource(source).replace(/\\/g, '/')
  if (PUBLIC_SOURCES.has(normalized)) return false
  if (normalized.startsWith('basis/testing/')) return true
  if (PRIVATE_WORKSPACE.test(normalized)) return true
  return INTERNAL_PATH.test(normalized)
}

// Whether the current file is itself part of the testing implementation.
const isImplementationFile = (filename: string): boolean => (
  filename.replace(/\\/g, '/').includes('/libraries/testing/')
    || filename.replace(/\\/g, '/').startsWith('libraries/testing/')
)

export const noDirectTestingInternals: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const filename = context.physicalFilename || context.filename
    if (isImplementationFile(filename)) return {}

    const check = (node: ESTree.Node, source: string | null): void => {
      if (source !== null && isPrivateSource(source)) {
        context.report({ messageId: 'noDirectTestingInternals', node })
      }
    }

    return {
      CallExpression(node: ESTree.CallExpression) {
        const reference = resolveReference(context, node.callee)
        const isRequire = reference?.origin.kind === 'global'
          && reference.origin.name === 'require'
          && reference.path.length === 0
        if (!isRequire) return
        const [first] = node.arguments
        check(node, literalString(first))
      },
      ExportAllDeclaration(node: ESTree.ExportAllDeclaration) {
        check(node, literalString(node.source))
      },
      ExportNamedDeclaration(node: ESTree.ExportNamedDeclaration) {
        check(node, literalString(node.source))
      },
      ImportDeclaration(node: ESTree.ImportDeclaration) {
        check(node, literalString(node.source))
      },
      ImportExpression(node: ESTree.ImportExpression) {
        check(node, literalString(node.source))
      },
    }
  },
  meta: {
    docs: {
      description: 'Require public Basis testing exports over private implementation paths.',
    },
    messages: {
      noDirectTestingInternals: [
        'Importing Basis testing implementation files is not allowed.',
        ' Import from the public `basis/testing` or `basis/testing/bun` surface instead.',
      ].join(''),
    },
    schema: [],
    type: 'problem',
  },
}
