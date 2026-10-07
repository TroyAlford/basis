import type { TSESTree } from '@typescript-eslint/types'
import type { Rule } from 'eslint'
import type * as ESTree from 'estree'

/** A JSON-ish expression that is nothing but spaces. */
const SPACES = /^ +$/

/** Elements whose whitespace is significant and must never be rewritten. */
const WHITESPACE_SENSITIVE = new Set(['pre', 'script', 'style', 'textarea'])

/**
 * Whether a source slice spans more than one line.
 * @param value - Source text to inspect.
 * @returns Whether the text spans more than one line.
 */
const hasNewline = (value: string): boolean => /\r|\n/.test(value)

/**
 * The literal whitespace a JSX child injects, or `null` when it injects none.
 * @param child - A JSX child node.
 * @returns The injected spaces, or `null`.
 */
const injectedSpace = (child: TSESTree.JSXChild): string | null => {
  if (child.type !== 'JSXExpressionContainer') return null
  const { expression } = child
  if (expression.type !== 'Literal' || typeof expression.value !== 'string') return null
  return SPACES.test(expression.value) ? expression.value : null
}

/**
 * Forbids `{' '}` whitespace injections in single-line JSX.
 *
 * A `{' '}` was the only way to keep a space across a wrapped line. Once inline
 * JSX is on one line that workaround is pointless: a literal space renders the
 * same and reads better. Multi-line elements keep their injections, because a
 * literal space beside a line break is dropped.
 */
export const noJsxSpaceInjection: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const source = context.sourceCode
    const textOf = (node: TSESTree.Node): string => source.getText(node as unknown as ESTree.Node)

    const check = (node: TSESTree.JSXElement | TSESTree.JSXFragment): void => {
      if (hasNewline(textOf(node))) return
      const name = node.type === 'JSXElement' && node.openingElement.name.type === 'JSXIdentifier'
        ? node.openingElement.name.name
        : null
      if (name !== null && WHITESPACE_SENSITIVE.has(name)) return

      for (const child of node.children) {
        const space = injectedSpace(child)
        if (space === null) continue
        const element = child as unknown as ESTree.Node
        context.report({
          fix: fixer => fixer.replaceText(element, space),
          messageId: 'noJsxSpaceInjection',
          node: element,
        })
      }
    }

    // JSX node types are absent from ESLint's ESTree-only listener type.
    return { JSXElement: check, JSXFragment: check } as unknown as Rule.RuleListener
  },
  meta: {
    docs: {
      description: 'Disallow `{" "}` whitespace injections in single-line JSX.',
    },
    fixable: 'code',
    messages: {
      noJsxSpaceInjection: 'Use a literal space instead of a `{\' \'}` injection.',
    },
    schema: [],
    type: 'layout',
  },
}
