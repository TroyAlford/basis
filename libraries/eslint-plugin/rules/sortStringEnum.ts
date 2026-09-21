/**
 * Ported from `eslint-plugin-typescript-sort-keys`
 * (https://github.com/infctr/eslint-plugin-typescript-sort-keys), released
 * under the ISC license. Original author: infctr <infctr@gmail.com>.
 *
 * Only the default Basis behavior is implemented: ascending, case-sensitive,
 * plain lexicographic comparison of string enum member names.
 */
import type { TSESLint } from '@typescript-eslint/utils'
import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import type { Rule } from 'eslint'
import { createReporter } from './sortInterface'

const stringEnumInvalidOrder = [
  'Expected string enum members to be in {{ order }}ending order.',
  " '{{ thisName }}' should be before '{{ prevName }}'.",
].join('')

export const sortStringEnum: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const ruleContext = context as unknown as TSESLint.RuleContext<'invalidOrder', []>
    const compareNodeListAndReport = createReporter(ruleContext, node => ({
      loc: node.loc,
      messageId: 'invalidOrder',
    }))
    const listener: TSESLint.RuleListener = {
      TSEnumDeclaration(node) {
        const body = node.body.members
        const isStringEnum = body.every(member => {
          const { initializer } = member
          if (!initializer || initializer.type !== AST_NODE_TYPES.Literal) return false
          return typeof initializer.value === 'string'
        })
        if (isStringEnum) compareNodeListAndReport(body)
      },
    }
    return listener as unknown as Rule.RuleListener
  },
  meta: {
    docs: {
      description: 'require string enum members to be sorted',
    },
    fixable: 'code',
    messages: {
      invalidOrder: stringEnumInvalidOrder,
    },
    schema: [],
    type: 'suggestion',
  },
}
