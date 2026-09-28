import { describe, expect, test } from 'bun:test'
import * as postcssStyledSyntax from 'postcss-styled-syntax'
import type { Config } from 'stylelint'
import { lintStyles } from '../testUtils'
import { noStateClasses, ruleName, STATE_CLASSES } from './noStateClasses'

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

  test('recommends the standard hidden attribute for .hidden, not :hidden', async () => {
    const { warnings } = await lintStyles(`
      .foo.component.hidden { display: none; }
    `, { config: config() })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.text).toContain('[hidden] or [data-hidden]')
    expect(warnings[0]?.text).not.toContain(':hidden')
  })

  test('does not recommend deprecated aria-grabbed for .dragging', async () => {
    const { warnings } = await lintStyles(`
      .foo.component.dragging { opacity: 0.5; }
    `, { config: config() })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.text).toContain('[data-dragging]')
    expect(warnings[0]?.text).not.toContain('aria-grabbed')
  })

  test('recommends neutral data-* for application-state vocabulary', async () => {
    const states = [
      'active', 'clickable', 'closed', 'collapsed', 'dragging', 'editing',
      'expanded', 'loading', 'open', 'pressed', 'selected', 'visible',
    ]
    const body = states.map(state => `.foo.component.${state} { color: red; }`).join('\n')
    const { warnings } = await lintStyles(body, { config: config() })

    expect(warnings).toHaveLength(states.length)
    for (const state of states) {
      const warning = warnings.find(candidate => candidate.text.includes(`.${state}"`))
      expect(warning?.text).toContain(`[data-${state}]`)
    }
  })

  test('makes element-dependent native states conditional, never ARIA', async () => {
    const fallbacks: Record<string, string> = {
      'checked': '[data-checked]',
      'disabled': '[data-disabled]',
      'invalid': '[data-invalid]',
      'read-only': '[data-read-only]',
    }

    for (const [state, fallback] of Object.entries(fallbacks)) {
      const { warnings } = await lintStyles(`
        .foo.component.${state} { color: red; }
      `, { config: config() })

      expect(warnings).toHaveLength(1)
      expect(warnings[0]?.text).toContain('native semantic')
      expect(warnings[0]?.text).toContain(fallback)
      expect(warnings[0]?.text).not.toMatch(/aria-|role=/)
    }
  })

  test('never prescribes synthetic accessibility semantics', () => {
    for (const suggestion of Object.values(STATE_CLASSES)) {
      expect(suggestion).not.toMatch(/aria-|role=/)
    }
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
