import type { Rule } from 'eslint'
import type * as ESTree from 'estree'

type PropertyNode = ESTree.Property & { parent: ESTree.Node }
type SpreadNode = ESTree.SpreadElement & { parent: ESTree.Node }

interface ObjectStack {
  prevName: string | null,
  prevNode: PropertyNode | null,
  upper: ObjectStack | null,
}

const getPropertyName = (node: ESTree.Property): string | null => {
  const key = node.key
  if (key.type === 'Literal') return String(key.value)
  if (key.type === 'TemplateLiteral' && key.expressions.length === 0 && key.quasis.length === 1) {
    return key.quasis[0]?.value.cooked ?? null
  }
  if (key.type === 'Identifier') return key.name || null
  return null
}

export const sortKeys: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    let stack: ObjectStack | null = null

    const resetSpread = (node: SpreadNode): void => {
      if (node.parent.type === 'ObjectExpression' && stack) stack.prevName = null
    }

    return {
      ExperimentalSpreadProperty(node: SpreadNode) {
        resetSpread(node)
      },

      ObjectExpression() {
        stack = {
          prevName: null,
          prevNode: null,
          upper: stack,
        }
      },

      'ObjectExpression:exit'() {
        stack = stack ? stack.upper : null
      },

      Property(node: PropertyNode) {
        if (node.parent.type === 'ObjectPattern' || !stack) return

        const prevName = stack.prevName
        const prevNode = stack.prevNode
        const thisName = getPropertyName(node)

        if (thisName !== null) {
          stack.prevName = thisName
          stack.prevNode = node
        }

        if (prevName === null || thisName === null || prevNode === null) return

        if (prevName <= thisName) return

        context.report({
          data: {
            order: 'asc',
            prevName,
            thisName,
          },
          fix(fixer): Rule.Fix[] {
            const fixes: Rule.Fix[] = []
            const moveProperty = (fromNode: PropertyNode, toNode: PropertyNode): void => {
              for (const comment of context.sourceCode.getCommentsBefore(fromNode)) {
                const text = context.sourceCode.getText(comment as unknown as ESTree.Node)
                fixes.push(fixer.insertTextBefore(toNode, `${text}\n`))
                fixes.push(fixer.remove(comment))
              }
              fixes.push(fixer.replaceText(toNode, context.sourceCode.getText(fromNode)))
            }
            moveProperty(node, prevNode)
            moveProperty(prevNode, node)
            return fixes
          },
          loc: node.key.loc ?? undefined,
          messageId: 'sortKeys',
          node,
        })
      },

      SpreadElement(node: SpreadNode) {
        resetSpread(node)
      },
    }
  },
  meta: {
    docs: {
      description: 'Require object keys to be sorted.',
    },
    fixable: 'code',
    messages: {
      sortKeys: "Expected object keys to be in {{order}}ending order. '{{thisName}}' should be before '{{prevName}}'.",
    },
    type: 'suggestion',
  },
}
