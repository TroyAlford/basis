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
 * Whether a top-level selector narrows or chains off a class-rooted scope and
 * should instead be nested inside that scope.
 *
 * A selector is rejected when its first compound contains a class selector and
 * either (a) the first compound also carries a state/narrowing selector (an
 * attribute, pseudo-class, or pseudo-element) or (b) a combinator follows. A
 * scope that is not class-rooted is left alone: `:root`, `html`, `body`, bare
 * attribute roots such as `[data-pin]`, and functional pseudo roots such as
 * `:is(...)` are legitimate top-level scopes.
 * @param selector - A parsed selector.
 * @returns True when the selector must be nested inside its owner.
 */
const shouldNest = (selector: selectorParser.Selector): boolean => {
  const nodes = selector.nodes
  const firstCombinator = nodes.findIndex(node => node.type === 'combinator')
  const scope = firstCombinator === -1 ? nodes : nodes.slice(0, firstCombinator)
  const classRooted = scope.some(node => node.type === 'class')
  const narrowed = scope.some(node => node.type === 'attribute' || node.type === 'pseudo')

  return classRooted && (narrowed || firstCombinator !== -1)
}

/**
 * Requires descendant, state, and pseudo-selectors to be nested inside their
 * owning selector instead of repeating avoidable top-level selector chains.
 *
 * A class-rooted top-level selector is reported when it chains a descendant,
 * child, or sibling combinator, or attaches a state/narrowing selector
 * (attribute, pseudo-class, or pseudo-element). The same selectors nested inside
 * their owner are fine, as are non-class scopes (`:root`, `html`, `body`, bare
 * attribute roots, and functional pseudo roots).
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

      if (!parsed.nodes.some(shouldNest)) return

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
