import { describe, expect, test } from 'bun:test'
import * as postcssStyledSyntax from 'postcss-styled-syntax'
import type { Config } from 'stylelint'
import { lintStyles } from '../testUtils'
import { noStateClasses, ruleName } from './noStateClasses'

const config = (ignore?: string[]): Config => ({
  customSyntax: postcssStyledSyntax,
  plugins: [noStateClasses],
  rules: {
    [ruleName]: ignore ? [true, { ignore }] : true,
  },
})

describe('basis/no-state-classes', () => {
  test('rejects a state class compounded with the component selector', async () => {
    const { warnings } = await lintStyles(`
      .button.component.disabled { color: red; }
    `, { config: config() })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.rule).toBe(ruleName)
    expect(warnings[0]?.text).toContain('.disabled')
  })

  test('rejects a state class compounded with the nesting selector', async () => {
    const { warnings } = await lintStyles(`
      .menu-item.component {
        &.selected { color: red; }
      }
    `, { config: config() })

    expect(warnings.map(warning => warning.text)).toEqual([
      expect.stringContaining('.selected'),
    ])
  })

  test('allows native, ARIA, and data-* state selectors', async () => {
    const { warnings } = await lintStyles(`
      .foo.component {
        &:disabled { color: gray; }
        &[disabled] { color: gray; }
        &[aria-selected='true'] { color: blue; }
        &[aria-expanded='true'] { color: blue; }
        &[data-open='true'] { color: blue; }
        &:hover { color: green; }
      }
    `, { config: config() })

    expect(warnings).toHaveLength(0)
  })

  test('allows structural, component, and mixin classes', async () => {
    const { warnings } = await lintStyles(`
      .table.editor.component {
        > .value, > .prefix, > .suffix { color: red; }
        > .table-cell.component { color: blue; }
      }
    `, { config: config() })

    expect(warnings).toHaveLength(0)
  })

  test('does not treat a class name inside an attribute value as a class', async () => {
    const { warnings } = await lintStyles(`
      .foo.component[data-value='.selected'] { color: red; }
    `, { config: config() })

    expect(warnings).toHaveLength(0)
  })

  test('parses interpolated attribute selectors without flagging them', async () => {
    const { warnings } = await lintStyles(`
      .foo.component[data-state="\${State.Selected}"] { color: red; }
    `, { config: config() })

    expect(warnings).toHaveLength(0)
  })

  test('permits ignored state classes through the secondary option', async () => {
    const { warnings } = await lintStyles(`
      .foo.component, .foo.component.open { color: red; }
    `, { config: config(['open']) })

    expect(warnings).toHaveLength(0)
  })
})
