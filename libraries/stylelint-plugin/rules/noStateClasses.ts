import type { Root } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import stylelint from 'stylelint'

const { createPlugin, utils: { report, ruleMessages, validateOptions } } = stylelint

/** The Stylelint rule name. */
export const ruleName = 'basis/no-state-classes'

/**
 * State/variant class names Basis forbids in `*.styles.ts`, mapped to the
 * native pseudo-class, attribute, ARIA, or `data-*` selector that should
 * express the same state.
 *
 * This is the explicit Basis semantic policy: the list is the vocabulary, not a
 * guess derived from arbitrary class names. Consumers can extend or narrow it
 * with the rule's `ignore` secondary option.
 */
export const STATE_CLASSES: Readonly<Record<string, string>> = {
  'active': '[data-active] or [aria-current]',
  'checked': ':checked or [aria-checked="true"]',
  'clickable': '[role="button"]',
  'closed': '[data-closed] or [aria-expanded="false"]',
  'collapsed': '[aria-expanded="false"]',
  'disabled': ':disabled or [disabled]',
  'dragging': '[data-dragging] or [aria-grabbed="true"]',
  'editing': '[data-editing]',
  'expanded': '[aria-expanded="true"]',
  'focused': ':focus or :focus-visible',
  'hidden': ':hidden or [hidden]',
  'hover': ':hover',
  'hovered': ':hover',
  'invalid': ':invalid or [aria-invalid="true"]',
  'loading': '[data-loading] or [aria-busy="true"]',
  'open': '[data-open] or [aria-expanded="true"]',
  'pressed': '[aria-pressed="true"]',
  'read-only': '[readonly] or [aria-readonly="true"]',
  'readonly': '[readonly] or [aria-readonly="true"]',
  'selected': '[aria-selected="true"] or [data-selected]',
  'visible': '[data-visible]',
}

const messages = ruleMessages(ruleName, {
  rejected: (name: string, suggestion: string) => (
    `Unexpected state class ".${name}". Use ${suggestion} instead of an ad-hoc state class.`
  ),
})

const meta = {
  url: 'https://github.com/TroyAlford/basis/blob/main/libraries/stylelint-plugin/README.md',
}

/** Secondary options accepted by `basis/no-state-classes`. */
interface SecondaryOptions {
  /** State class names (with or without a leading dot) to permit. */
  ignore?: string[],
}

/**
 * Forbids representing component state and variants with ad-hoc state classes.
 *
 * Basis expresses state through native pseudo-classes/attributes, ARIA
 * attributes, and `data-*` attributes. Structural, component, and mixin classes
 * are unaffected because only names in {@link STATE_CLASSES} are rejected.
 * @param primary Whether the rule is enabled.
 * @param secondaryOptions Additional rule options.
 * @returns A Stylelint rule visitor.
 */
const visitor = (primary: boolean, secondaryOptions?: SecondaryOptions) => (
  (root: Root, result: stylelint.PostcssResult) => {
    const options = secondaryOptions ?? {}
    const validOptions = validateOptions(
      result,
      ruleName,
      { actual: primary, possible: [true] },
      {
        actual: options,
        optional: true,
        possible: {
          ignore: [value => typeof value === 'string'],
        },
      },
    )

    if (!validOptions) return

    const ignore = new Set((options.ignore ?? []).map(name => name.replace(/^\./, '')))

    root.walkRules(rule => {
      const { selector } = rule
      if (!selector.includes('.')) return

      let parsed: selectorParser.Root
      try {
        parsed = selectorParser().astSync(selector)
      } catch {
        return
      }

      parsed.walkClasses(classNode => {
        const name = classNode.value
        const suggestion = STATE_CLASSES[name]
        if (!suggestion || ignore.has(name)) return

        report({
          message: messages.rejected(name, suggestion),
          node: rule,
          result,
          ruleName,
        })
      })
    })
  }
)

/** The Basis rule that rejects ad-hoc state classes. */
export const noStateClasses = createPlugin(
  ruleName,
  Object.assign(visitor as stylelint.RuleBase, { messages, meta, ruleName }),
)
