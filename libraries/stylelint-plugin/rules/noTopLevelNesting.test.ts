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

  test('rejects a top-level child chain', async () => {
    const { warnings } = await lintStyles(`
      [data-has-prefix] > .prefix { color: red; }
    `, { config })

    expect(warnings).toHaveLength(1)
  })

  test('allows the same selectors nested inside their owner', async () => {
    const { warnings } = await lintStyles(`
      .button.component {
        > .label { color: red; }
        &.open { color: blue; }
      }

      [data-has-prefix] {
        > .prefix { color: green; }
      }
    `, { config })

    expect(warnings).toHaveLength(0)
  })

  test('allows simple top-level scopes and custom property roots', async () => {
    const { warnings } = await lintStyles(`
      :root { --basis-color: red; }
      html, body { margin: 0; }
      .foo.component { color: red; }
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
