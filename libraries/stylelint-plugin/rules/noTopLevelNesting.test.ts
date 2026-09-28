import { describe, expect, test } from 'bun:test'
import * as postcssStyledSyntax from 'postcss-styled-syntax'
import type { Config } from 'stylelint'
import { lintStyles } from '../testUtils'
import { noTopLevelNesting, ruleName } from './noTopLevelNesting'

const config: Config = {
  customSyntax: postcssStyledSyntax,
  plugins: [noTopLevelNesting],
  rules: { [ruleName]: true },
}

describe('basis/no-top-level-nesting', () => {
  test('rejects a top-level descendant chain rooted at a component', async () => {
    const { warnings } = await lintStyles(`
      .button.component .label { color: red; }
    `, { config })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.rule).toBe(ruleName)
    expect(warnings[0]?.text).toContain('.button.component .label')
  })

  test('rejects top-level state, pseudo, and attribute selectors on a class scope', async () => {
    const { warnings } = await lintStyles(`
      .button.component:hover { color: red; }
      .button.component::before { content: ''; }
      .button.component[data-open='true'] { color: blue; }
      .button.component[aria-expanded='true'] { color: green; }
    `, { config })

    expect(warnings).toHaveLength(4)
    for (const warning of warnings) expect(warning.rule).toBe(ruleName)
  })

  test('accepts the same selectors nested in their owner', async () => {
    const { warnings } = await lintStyles(`
      .button.component {
        &:hover { color: red; }
        &::before { content: ''; }
        &[data-open='true'] { color: blue; }
        &[aria-expanded='true'] { color: green; }
        > .label { color: purple; }
      }
    `, { config })

    expect(warnings).toHaveLength(0)
  })

  test('allows non-class roots, attribute roots, and functional pseudo roots', async () => {
    const { warnings } = await lintStyles(`
      :root { --basis-color: red; }
      html, body { margin: 0; }
      main { color: black; }
      [data-pin] { position: sticky; }
      [data-has-prefix] > .prefix, [data-has-suffix] > .suffix { color: red; }
      :is(.a, .b) { color: blue; }
      .button.component { color: green; }
      svg.icon.component { display: inline-flex; }
    `, { config })

    expect(warnings).toHaveLength(0)
  })

  test('ignores combinators nested inside functional pseudo-classes', async () => {
    const { warnings } = await lintStyles(`
      :is(.a > .b) { color: red; }
    `, { config })

    expect(warnings).toHaveLength(0)
  })
})
