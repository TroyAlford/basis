import type { Node, Root, Rule } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import stylelint from 'stylelint'

const { createPlugin, utils: { report, ruleMessages, validateOptions } } = stylelint

/** The Stylelint rule name. */
export const ruleName = 'basis/no-top-level-nesting'

const messages = ruleMessages(ruleName, {
  rejected: (selector: string) => (
    `Unexpected top-level selector chain "${selector}". Nest descendants, states, ` +
    'and pseudo-selectors inside their owning selector.'
  ),
})

const meta = {
  url: 'https://github.com/TroyAlford/basis/blob/main/libraries/stylelint-plugin/README.md',
}

/**
 * Whether a rule sits at the top level of the stylesheet rather than inside
 * another rule.
 * @param rule The rule node to inspect.
 * @returns True when no ancestor rule owns this rule.
 */
const isTopLevel = (rule: Rule): boolean => {
  let parent: Node | undefined = rule.parent
  while (parent) {
    if (parent.type === 'rule') return false
    parent = parent.parent
  }
  return true
}

/**
 * Requires descendant, state, and pseudo-selectors to be nested inside their
 * owning selector instead of repeating avoidable top-level selector chains.
 *
 * A top-level selector that contains a combinator (descendant, child, or
 * sibling) is reported; the same selector nested inside its owner is fine.
 * @param primary Whether the rule is enabled.
 * @returns A Stylelint rule visitor.
 */
const visitor = (primary: boolean) => (
  (root: Root, result: stylelint.PostcssResult) => {
    const validOptions = validateOptions(result, ruleName, {
      actual: primary,
      possible: [true],
    })

    if (!validOptions) return

    root.walkRules(rule => {
      if (!isTopLevel(rule)) return
      if (!rule.selector) return

      let parsed: selectorParser.Root
      try {
        parsed = selectorParser().astSync(rule.selector)
      } catch {
        return
      }

      const chained = parsed.nodes.some(selector => (
        selector.nodes.some(node => node.type === 'combinator')
      ))

      if (!chained) return

      report({
        message: messages.rejected(rule.selector),
        node: rule,
        result,
        ruleName,
      })
    })
  }
)

/** The Basis rule that requires nesting over repeated top-level selector chains. */
export const noTopLevelNesting = createPlugin(
  ruleName,
  Object.assign(visitor as stylelint.RuleBase, { messages, meta, ruleName }),
)
