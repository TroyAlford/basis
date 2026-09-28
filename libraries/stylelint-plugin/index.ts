import * as postcssStyledSyntax from 'postcss-styled-syntax'
import type { Config } from 'stylelint'
import orderPlugins from 'stylelint-order'
import { basisPlugins } from './rules/index'

/**
 * The Basis CSS policy, independent of `*.styles.ts` parsing. Exported so tests
 * and tooling can exercise the rules directly, and so consumers can override
 * individual rules with {@link createConfig}.
 */
export const BASE_RULES: Config['rules'] = {
  'at-rule-no-unknown': true,
  'basis/no-avoidable-nesting': true,
  'basis/no-state-classes': true,
  'block-no-empty': true,
  'color-no-invalid-hex': true,
  'declaration-block-no-duplicate-properties': [true, {
    ignore: ['consecutive-duplicates-with-different-values'],
  }],
  'declaration-block-no-shorthand-property-overrides': true,
  'font-family-no-duplicate-names': true,
  'function-no-unknown': true,
  'keyframe-block-no-duplicate-selectors': true,
  'max-nesting-depth': 6,
  'media-feature-name-no-unknown': true,
  'no-duplicate-at-import-rules': true,
  'no-duplicate-selectors': true,
  'no-invalid-double-slash-comments': true,
  'no-invalid-position-at-import-rule': true,
  'order/custom-properties-alphabetical-order': true,
  'order/order': [['custom-properties', 'declarations'], { unspecified: 'bottom' }],
  'order/properties-alphabetical-order': true,
  'property-no-unknown': true,
  'selector-anb-no-unmatchable': true,
  'selector-max-id': 0,
  'selector-pseudo-class-no-unknown': true,
  'selector-pseudo-element-no-unknown': true,
  'selector-type-case': 'lower',
  'selector-type-no-unknown': true,
  'string-no-newline': true,
  'unit-no-unknown': true,
}

/**
 * Options accepted by {@link createConfig}.
 */
export interface CreateConfigOptions {
  /** Flat-config style overrides, appended after the Basis policy. */
  overrides?: Config['overrides'],
  /** Extra or overriding rule settings merged over the Basis policy. */
  rules?: Config['rules'],
}

/**
 * Builds the Basis Stylelint configuration for a consumer project.
 *
 * The configuration targets `*.styles.ts` through the `postcss-styled-syntax`
 * custom syntax, so it parses `css` tagged template literals (including nesting
 * and `${...}` interpolations) rather than treating them as plain strings.
 * Basis owns every plugin, custom syntax, and rule setting the configuration
 * references; consumers do not enumerate them.
 * @param options Additional rule settings and overrides.
 * @returns A Stylelint configuration object.
 */
export const createConfig = (options: CreateConfigOptions = {}): Config => {
  const { overrides = [], rules = {} } = options
  return {
    customSyntax: postcssStyledSyntax,
    overrides,
    plugins: [...orderPlugins, ...basisPlugins],
    rules: { ...BASE_RULES, ...rules },
  }
}
