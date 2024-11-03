import type { TSESTree } from '@typescript-eslint/types'
import { ESLintUtils } from '@typescript-eslint/utils'

const createRule = ESLintUtils.RuleCreator(
  name => `https://example.com/rule/${name}`,
)

export const noMixedTypeImports = createRule({
  create: context => ({
    ImportDeclaration(node: TSESTree.ImportDeclaration) {
      const imports = {
        type: new Set<string>(),
        value: new Set<string>(),
      }
      const semi = context.sourceCode.getText(node).endsWith(';') ? ';' : ''

      node.specifiers.forEach(specifier => {
        if (specifier.type !== 'ImportSpecifier') return
        const importedName = specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : specifier.imported.value
        imports[specifier.importKind].add(importedName)
      })

      if (!imports.type.size || !imports.value.size) return

      context.report({
        fix: fixer => fixer.replaceTextRange(node.range, [
          `import type { ${[...imports.type].join(', ')} } from '${node.source.value}'${semi}`,
          `import { ${[...imports.value].join(', ')} } from '${node.source.value}'${semi}`,
        ].join('\n')),
        messageId: 'noMixedTypeImports',
        node,
      })
    },
  }),
  defaultOptions: [],
  meta: {
    docs: {
      description: 'Disallow mixing `type` and non-`type` imports on the same line.',
    },
    fixable: 'code',
    messages: {
      noMixedTypeImports: '`type` and non-`type` imports must be split onto separate statements.',
    },

    schema: [],
    type: 'suggestion',
  },
  name: 'no-mixed-type-imports',
})
