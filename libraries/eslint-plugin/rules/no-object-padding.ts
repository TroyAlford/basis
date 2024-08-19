import { ESLintUtils } from '@typescript-eslint/utils'
import type { RuleContext } from '@typescript-eslint/utils/ts-eslint'

const createRule = ESLintUtils.RuleCreator(
  name => `https://example.com/rule/${name}`,
)
const WHITESPACE_LINE = /^\s*[\r\n]/gm

export const noObjectPadding = createRule({
  create: (context: RuleContext<'unexpectedPaddingEnd' | 'unexpectedPaddingStart', []>) => ({
    ObjectExpression(node) {
      if (node.properties.length === 0) return
      const { sourceCode } = context
      const open = sourceCode.getFirstToken(node)
      const close = sourceCode.getLastToken(node)
      const first = node.properties[0]
      const last = node.properties[node.properties.length - 1]

      const code = sourceCode.text.slice(open.range[1], close.range[0])
      const lines = code.split('\n')
      if (lines.length === 1) return

      const opening = sourceCode.text.slice(open.range[0] - 1, first.range[0])
      const closing = sourceCode.text.slice(last.range[1] - 1, close.range[0])
      const hasLeading = WHITESPACE_LINE.test(opening)
      const hasTailing = WHITESPACE_LINE.test(closing)

      if (hasLeading) {
        context.report({
          fix: fixer => fixer.replaceTextRange(
            [open.range[0] - 1, first.range[0]],
            opening.replace(WHITESPACE_LINE, ''),
          ),
          messageId: 'unexpectedPaddingStart',
          node: first,
        })
      }

      if (hasTailing) {
        context.report({
          fix: fixer => fixer.replaceTextRange(
            [last.range[1] - 1, close.range[0]],
            closing.replace(WHITESPACE_LINE, ''),
          ),
          messageId: 'unexpectedPaddingEnd',
          node: last,
        })
      }
    },
  }),
  defaultOptions: [],
  meta: {
    docs: {
      description: 'Disallow or enforce padding lines at the beginning and end of object declarations',
    },
    fixable: 'whitespace',
    messages: {
      unexpectedPaddingEnd: 'Unexpected blank line at the end of object declaration.',
      unexpectedPaddingStart: 'Unexpected blank line at the beginning of object declaration.',
    },
    schema: [],
    type: 'layout',
  },
  name: 'no-object-padding',
})
