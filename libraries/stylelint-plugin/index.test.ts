import { describe, expect, test } from 'bun:test'
import { createConfig } from './index'
import { ruleName as noStateClasses } from './rules/noStateClasses'
import { lintStyles } from './testUtils'

describe('createConfig', () => {
  test('owns the custom syntax, plugins, and Basis rules', () => {
    const config = createConfig()

    expect(config.customSyntax).toBeDefined()
    expect(Array.isArray(config.plugins)).toBe(true)
    expect(config.rules?.['basis/no-state-classes']).toBe(true)
    expect(config.rules?.['basis/no-top-level-nesting']).toBe(true)
    expect(config.rules?.['order/properties-alphabetical-order']).toBe(true)
  })

  test('merges consumer rule settings over the Basis policy', () => {
    const config = createConfig({
      rules: { [noStateClasses]: [true, { ignore: ['open'] }] },
    })

    expect(config.rules?.[noStateClasses]).toEqual([true, { ignore: ['open'] }])
  })
})

describe('Basis CSS policy over *.styles.ts fixtures', () => {
  test('parses nested CSS and interpolated selectors and values', async () => {
    const { warnings } = await lintStyles(`
      .foo.component {
        color: \${Color.Primary};

        > .value {
          &:hover { color: \${Color.Hover}; }
        }

        &[data-state="\${State.Selected}"] { color: red; }
      }
    `, { config: createConfig() })

    expect(warnings).toHaveLength(0)
  })

  test('accepts structural, native, ARIA, and data-* selectors', async () => {
    const { warnings } = await lintStyles(`
      .foo.component {
        color: red;

        > .value, > .prefix, > .suffix { color: blue; }

        &:disabled { color: gray; }
        &[aria-expanded='true'] { color: green; }
        &[data-open='true'] { color: green; }
      }
    `, { config: createConfig() })

    expect(warnings).toHaveLength(0)
  })

  test('rejects ad-hoc state classes with the Basis rule', async () => {
    const { warnings } = await lintStyles(`
      .foo.component {
        &.selected { color: red; }
      }
    `, { config: createConfig() })

    expect(warnings.map(warning => warning.rule)).toContain(noStateClasses)
  })

  test('reports and autofixes declaration ordering', async () => {
    const body = `
      .foo.component {
        top: 0;
        color: red;
      }
    `

    const before = await lintStyles(body, { config: createConfig() })
    expect(before.warnings.map(warning => warning.rule)).toContain('order/properties-alphabetical-order')

    const after = await lintStyles(body, { config: createConfig(), fix: true })
    const fixed = after.fixed ?? ''
    expect(fixed.indexOf('color: red')).toBeLessThan(fixed.indexOf('top: 0'))
    expect(after.warnings).toHaveLength(0)
  })

  test('reports and autofixes custom property ordering', async () => {
    const body = `
      :root {
        --basis-b: 2;
        --basis-a: 1;
      }
    `

    const after = await lintStyles(body, { config: createConfig(), fix: true })
    const fixed = after.fixed ?? ''
    expect(fixed.indexOf('--basis-a')).toBeLessThan(fixed.indexOf('--basis-b'))
  })

  test('reports and autofixes nested rules that precede declarations', async () => {
    const body = `
      .foo.component {
        &:hover { color: red; }

        color: blue;
      }
    `

    const after = await lintStyles(body, { config: createConfig(), fix: true })
    const fixed = after.fixed ?? ''
    expect(fixed.indexOf('color: blue')).toBeLessThan(fixed.indexOf('&:hover'))
  })

  test('keeps template interpolations intact when autofixing ordering', async () => {
    const body = `
      .foo.component {
        \${rules}

        top: 0;
        color: red;
      }
    `

    const after = await lintStyles(body, { config: createConfig(), fix: true })
    const fixed = after.fixed ?? ''
    expect(fixed).toContain('${rules}')
    expect(fixed.indexOf('${rules}')).toBeLessThan(fixed.indexOf('color: red'))
  })
})
