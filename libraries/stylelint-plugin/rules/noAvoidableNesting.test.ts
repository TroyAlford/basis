import { describe, expect, test } from 'bun:test'
import * as postcssStyledSyntax from 'postcss-styled-syntax'
import type { Config } from 'stylelint'
import { lintStyles } from '../testUtils'
import { noAvoidableNesting, ruleName } from './noAvoidableNesting'

const config: Config = {
  customSyntax: postcssStyledSyntax,
  plugins: [noAvoidableNesting],
  rules: { [ruleName]: true },
}

/**
 * Collapse whitespace so assertions compare selector tree shape, not formatting.
 * @param css - The CSS text to normalize.
 * @returns The whitespace-normalized CSS.
 */
const squash = (css: string): string => css.replace(/\s+/g, ' ').trim()

/**
 * Pull the CSS body out of the `stylesModule` wrapper.
 * @param source - The fixed module source.
 * @returns The CSS body between the tagged template backticks.
 */
const extractBody = (source: string): string => {
  const start = source.indexOf('css`')
  const end = source.lastIndexOf('`)')
  return source.slice(start + 4, end)
}

/**
 * Lint a body, optionally autofixing, returning the canonical body and warnings.
 * @param body - The CSS body to lint.
 * @param fix - Whether to apply autofixes.
 * @returns The canonical body and the number of warnings.
 */
const canonical = async (body: string, fix = true): Promise<{
  body: string,
  warnings: number,
}> => {
  const result = await lintStyles(body, { config, fix })
  return {
    body: result.fixed ? squash(extractBody(result.fixed)) : squash(body),
    warnings: result.warnings.length,
  }
}

describe('basis/no-avoidable-nesting canonical tree', () => {
  test('reports a non-canonical stylesheet when not fixing', async () => {
    const { body, warnings } = await canonical(`
      .panel {
        color: red;

        > ul {
          > li { color: blue; }
        }
      }
    `, false)

    expect(warnings).toBeGreaterThan(0)
    expect(body).toContain('> ul')
  })

  test('flattens a redundant unary child with a leading combinator', async () => {
    const { body } = await canonical(`
      .panel {
        color: red;

        > ul {
          > li { color: blue; }
        }
      }
    `)

    expect(body).toBe(squash(`
      .panel {
        color: red;
        > ul > li { color: blue; }
      }
    `))
  })

  test('flattens a redundant unary child with a class owner', async () => {
    const { body } = await canonical(`
      .panel {
        color: red;

        > .actions {
          > button { cursor: pointer; }
        }
      }
    `)

    expect(body).toBe(squash(`
      .panel {
        color: red;
        > .actions > button { cursor: pointer; }
      }
    `))
  })

  test('keeps a branching parent nested', async () => {
    const input = `
      .panel {
        color: red;

        > .header {
          > .title { color: blue; }
          > .actions { color: green; }
        }
      }
    `
    const { body, warnings } = await canonical(input)

    expect(warnings).toBe(0)
    expect(body).toBe(squash(input))
  })

  test('keeps a parent with its own declarations and one child nested', async () => {
    const input = `
      .panel {
        color: red;

        > .header {
          color: blue;

          > .title { color: green; }
        }
      }
    `
    const { body, warnings } = await canonical(input)

    expect(warnings).toBe(0)
    expect(body).toBe(squash(input))
  })

  test('factors repeated flat prefixes then compresses unary descendants', async () => {
    const { body } = await canonical(`
      .header > .title { color: red; }
      .header > .title:hover { color: blue; }
      .header > .actions > button { color: green; }
    `)

    expect(body).toBe(squash(`
      .header {
        > .title {
          color: red;
          &:hover { color: blue; }
        }
        > .actions > button { color: green; }
      }
    `))
  })

  test('keeps a lone flat component state selector flat', async () => {
    const input = '.button.component:hover { color: red; }'
    const { body, warnings } = await canonical(input)

    expect(warnings).toBe(0)
    expect(body).toBe(squash(input))
  })

  test('preserves a protected component root with only one child', async () => {
    const input = `
      .button.component {
        &:hover { color: red; }
      }
    `
    const { body, warnings } = await canonical(input)

    expect(warnings).toBe(0)
    expect(body).toBe(squash(input))
  })

  test('factors a flat state selector into an existing component root', async () => {
    const { body } = await canonical(`
      .button.component { color: red; }
      .button.component:hover { color: blue; }
    `)

    expect(body).toBe(squash(`
      .button.component {
        color: red;
        &:hover { color: blue; }
      }
    `))
  })

  test('factors a shared owner out of a selector list', async () => {
    const { body } = await canonical(`
      p:first-child, p:last-child { margin: 0; }
    `)

    expect(body).toBe(squash(`
      p {
        &:first-child,
        &:last-child { margin: 0; }
      }
    `))
  })

  test('keeps a selector list with distinct owners intact', async () => {
    const input = 'th, td { height: 1em; }'
    const { body, warnings } = await canonical(input)

    expect(warnings).toBe(0)
    expect(body).toBe(squash(input))
  })

  test('keeps reverse and relative nesting selectors intact', async () => {
    const input = `
      .card.component {
        [disabled] & { color: red; }
        .theme & { color: blue; }
        &:hover { color: green; }
        &[data-open='true'] { color: gray; }
        *:has(> &) { display: block; }
      }
    `
    const { body, warnings } = await canonical(input)

    expect(warnings).toBe(0)
    expect(body).toBe(squash(input))
  })

  test('flattens the issue layout regression', async () => {
    const { body } = await canonical(`
      .layout.component {
        color: red;

        > nav {
          > ul {
            > li { padding-left: 1em; }
          }

          > .other { color: blue; }
        }
      }
    `)

    expect(body).toBe(squash(`
      .layout.component {
        color: red;
        > nav {
          > ul > li { padding-left: 1em; }
          > .other { color: blue; }
        }
      }
    `))
  })

  test('coalesces sibling rules with identical bodies into one selector list', async () => {
    const { body } = await canonical(`
      &[data-align="\${align}"] {
        &, > .editor {
          justify-content: \${align};
          text-align: \${align};
        }

        > .editor > .value {
          justify-content: \${align};
          text-align: \${align};
        }
      }
    `)

    expect(body).toBe(squash(`
      &[data-align="\${align}"] {
        &, > .editor, > .editor > .value {
          justify-content: \${align};
          text-align: \${align};
        }
      }
    `))
  })

  test('accepts an already-coalesced selector list unchanged', async () => {
    const input = `
      &[data-align="\${align}"] {
        &, > .editor, > .editor > .value {
          justify-content: \${align};
          text-align: \${align};
        }
      }
    `
    const { body, warnings } = await canonical(input)

    expect(warnings).toBe(0)
    expect(body).toBe(squash(input))
  })

  test('flattens a declaration-less unary rule with an interpolated owner', async () => {
    const { body } = await canonical(`
      &[data-align="\${TextAlign.Center}"] {
        > .content > .title {
          text-align: center;
        }
      }
    `)

    expect(body).toBe(squash(`
      &[data-align="\${TextAlign.Center}"] > .content > .title {
        text-align: center;
      }
    `))
  })

  test('is idempotent for the interpolated alignment chains', async () => {
    const input = `
      &[data-align="\${TextAlign.Center}"] > .content > .title { text-align: center; }
      &[data-align="\${TextAlign.Left}"] > .content > .title { text-align: left; }
      &[data-align="\${TextAlign.Right}"] > .content > .title { text-align: right; }
    `
    const { body, warnings } = await canonical(input)

    expect(warnings).toBe(0)
    expect(body).toBe(squash(input))
  })
})
