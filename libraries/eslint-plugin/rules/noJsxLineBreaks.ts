import type { TSESTree } from '@typescript-eslint/types'
import type { Rule } from 'eslint'
import type * as ESTree from 'estree'

/** HTML elements that establish block structure; any such descendant forbids a one-line collapse. */
const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'dialog', 'div',
  'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'nav', 'ol',
  'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

/** Elements whose whitespace is significant and must never be collapsed. */
const WHITESPACE_SENSITIVE = new Set(['pre', 'script', 'style', 'textarea'])

/**
 * Whether a source slice spans more than one line.
 * @param value - Source text to inspect.
 * @returns Whether the text spans more than one line.
 */
const hasNewline = (value: string): boolean => /\r|\n/.test(value)

/**
 * Collapse a JSX text node's multi-line source into the single line React
 * renders, mirroring Babel's `cleanJSXElementLiteralChild`. Whitespace runs
 * that contain a line break become one space, and the indentation at the edges
 * of the node is dropped.
 * @param raw - The raw JSX text, including its line breaks and indentation.
 * @returns The equivalent single-line text.
 */
const clean = (raw: string): string => {
  const lines = raw.split(/\r\n|\n|\r/)
  let lastNonEmptyLine = 0
  for (let index = 0; index < lines.length; index += 1) {
    if (/[^ \t]/.test(lines[index])) lastNonEmptyLine = index
  }

  let result = ''
  for (let index = 0; index < lines.length; index += 1) {
    const isFirstLine = index === 0
    const isLastLine = index === lines.length - 1
    let line = lines[index].replace(/\t/g, ' ')
    if (!isFirstLine) line = line.replace(/^ +/, '')
    if (!isLastLine) line = line.replace(/ +$/, '')
    if (line) {
      if (index !== lastNonEmptyLine) line += ' '
      result += line
    }
  }

  return result
}

/**
 * The tag name of an opening element.
 * @param node - The opening element to inspect.
 * @returns The tag name, or `null` for a namespaced or member name.
 */
const tagName = (node: TSESTree.JSXOpeningElement): string | null => (
  node.name.type === 'JSXIdentifier' ? node.name.name : null
)

/**
 * Forbids breaking inline JSX content across multiple source lines.
 *
 * A renderer word-wraps, so an element whose children are all inline — text,
 * embedded expressions, and inlined elements — belongs on one line, opening
 * and closing tags included. Block-level content (`div`, `p`, `ul`, …) and
 * whitespace-sensitive elements are left structured. The autofix rewrites the
 * whole element, so the closing-tag and indentation rules still hold.
 */
export const noJsxLineBreaks: Rule.RuleModule = {
  create(context: Rule.RuleContext): Rule.RuleListener {
    const source = context.sourceCode
    const textOf = (node: TSESTree.Node): string => source.getText(node as unknown as ESTree.Node)
    const inlineCache = new WeakMap<TSESTree.Node, boolean>()

    const isInline = (node: TSESTree.JSXChild): boolean => {
      if (node.type === 'JSXText') return true
      if (node.type === 'JSXExpressionContainer') {
        return node.expression.type !== 'JSXEmptyExpression' && !hasNewline(textOf(node))
      }
      if (node.type !== 'JSXElement' && node.type !== 'JSXFragment') return false

      const cached = inlineCache.get(node)
      if (cached !== undefined) return cached

      const name = node.type === 'JSXElement' ? tagName(node.openingElement) : null
      const blocked = name !== null && (BLOCK_ELEMENTS.has(name) || WHITESPACE_SENSITIVE.has(name))
      const result = !blocked
        && !hasNewline(textOf(node))
        && node.children.every(child => isInline(child))
      inlineCache.set(node, result)
      return result
    }

    const check = (node: TSESTree.JSXElement | TSESTree.JSXFragment): void => {
      if (node.type === 'JSXElement') {
        const name = tagName(node.openingElement)
        if (node.openingElement.selfClosing) return
        if (name !== null && WHITESPACE_SENSITIVE.has(name)) return
        if (hasNewline(textOf(node.openingElement))) return
      }

      const hasText = node.children.some(child => child.type === 'JSXText' && /[^ \t\r\n]/.test(textOf(child)))
      if (!hasText) return
      if (hasNewline(textOf(node)) === false) return
      if (!node.children.every(child => isInline(child))) return

      const opening = node.type === 'JSXElement'
        ? textOf(node.openingElement)
        : textOf(node.openingFragment)
      const closing = node.type === 'JSXElement'
        ? node.closingElement === null ? '' : textOf(node.closingElement)
        : textOf(node.closingFragment)
      const inner = node.children
        .map(child => (child.type === 'JSXText' ? clean(textOf(child)) : textOf(child)))
        .join('')
      const element = node as unknown as ESTree.Node

      context.report({
        fix: fixer => fixer.replaceText(element, opening + inner + closing),
        messageId: 'noJsxLineBreaks',
        node: element,
      })
    }

    // JSX node types are absent from ESLint's ESTree-only listener type.
    return { JSXElement: check, JSXFragment: check } as unknown as Rule.RuleListener
  },
  meta: {
    docs: {
      description: 'Disallow line breaks inside inline JSX; let the renderer word-wrap.',
    },
    fixable: 'code',
    messages: {
      noJsxLineBreaks: 'Keep inline JSX on one line; let the renderer word-wrap.',
    },
    schema: [],
    type: 'layout',
  },
}
