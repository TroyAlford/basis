/**
 * Ported from `eslint-plugin-import`
 * (https://github.com/import-js/eslint-plugin-import), released under the MIT
 * license. Original author: Ben Mosher <me@benmosher.com>.
 *
 * Forbids default exports and `default` aliases when linting module source.
 */

import type { Rule } from 'eslint'
import type * as ESTree from 'estree'

interface DefaultSpecifier {
  exported: ESTree.Identifier | ESTree.Literal,
  local: ESTree.Identifier | ESTree.Literal,
  type: string,
}

const getName = (node: ESTree.Identifier | ESTree.Literal): string => {
  if (node.type === 'Identifier') return node.name
  return node.value === null ? '' : String(node.value)
}

const getSourceType = (context: Rule.RuleContext): string | undefined => {
  const parserOptions = context.languageOptions.parserOptions as { sourceType?: string } | undefined
  return parserOptions?.sourceType ?? context.languageOptions.sourceType
}

export const noDefaultExport: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    // Ignore non-modules.
    if (getSourceType(context) !== 'module') return {}

    const { sourceCode } = context

    const reportLoc = (node: ESTree.Node): ESTree.SourceLocation | undefined => sourceCode.getFirstTokens(node)[1]?.loc

    return {
      ExportDefaultDeclaration(node: ESTree.ExportDefaultDeclaration) {
        context.report({ loc: reportLoc(node), messageId: 'preferNamed', node })
      },

      ExportNamedDeclaration(node: ESTree.ExportNamedDeclaration) {
        const specifiers = node.specifiers as DefaultSpecifier[]
        for (const specifier of specifiers) {
          if (getName(specifier.exported) !== 'default') continue
          if (specifier.type === 'ExportDefaultSpecifier') {
            context.report({ loc: reportLoc(node), messageId: 'preferNamed', node })
          } else if (specifier.type === 'ExportSpecifier') {
            context.report({
              data: { local: getName(specifier.local) },
              loc: reportLoc(node),
              messageId: 'noAliasDefault',
              node,
            })
          }
        }
      },
    }
  },
  meta: {
    docs: {
      description: 'Forbid default exports.',
    },
    messages: {
      noAliasDefault: 'Do not alias `{{local}}` as `default`. Just export `{{local}}` itself instead.',
      preferNamed: 'Prefer named exports.',
    },
    schema: [],
    type: 'suggestion',
  },
}
