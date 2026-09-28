import * as postcssStyledSyntax from 'postcss-styled-syntax'
import type { Config } from 'stylelint'
import stylelint from 'stylelint'

/**
 * Wraps a CSS body in a `*.styles.ts`-shaped module so fixtures parse through
 * the same `postcss-styled-syntax` custom syntax consumers use.
 * @param body The CSS body to embed.
 * @returns A TypeScript module that registers the CSS.
 */
export const stylesModule = (body: string): string => `import { css, style } from './style'

style('basis:fixture', css\`
${body}
\`)
`

/** Options accepted by {@link lintStyles}. */
export interface LintStylesOptions {
  /** The Stylelint configuration to lint with. Defaults to no rules. */
  config?: Config,
  /** Whether to apply autofixes. Defaults to `false`. */
  fix?: boolean,
}

/** The observable outcome of a {@link lintStyles} run. */
export interface LintStylesOutcome {
  /** The autofixed source when `fix` was requested. */
  fixed: string | undefined,
  /** Every warning reported across the parsed stylesheets. */
  warnings: stylelint.Warning[],
}

/**
 * Lints a CSS body as if it were a `*.styles.ts` module.
 * @param body The CSS body to lint.
 * @param options Configuration and autofix options.
 * @returns The warnings and, when requested, the autofixed source.
 */
export const lintStyles = async (
  body: string,
  options: LintStylesOptions = {},
): Promise<LintStylesOutcome> => {
  const { config = { customSyntax: postcssStyledSyntax, rules: {} }, fix = false } = options
  const result = await stylelint.lint({ code: stylesModule(body), config, fix })

  return {
    fixed: fix ? result.code : undefined,
    warnings: result.results.flatMap(entry => entry.warnings),
  }
}
