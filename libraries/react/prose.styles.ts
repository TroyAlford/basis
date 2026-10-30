import { css, style } from './utilities/style'

/**
 * Basis-wide defaults for ordinary semantic HTML content.
 * Application-wide layout reset belongs in global.styles.ts.
 */
style('basis:prose', css`
  h1, h2, h3, h4, h5, h6 {
    margin: 0;
    padding: 0;
  }

  p, ul, ol, dl, blockquote, pre, table, figure {
    margin: 0;
  }

  :not(pre):not(.code.component) > code {
    color: var(--basis-color-success);
    font-family: 'Fira Code', monospace;
    font-variant-ligatures: contextual;
    font-weight: 500;
  }

  pre {
    background-color: var(--basis-color-surface-code);
    border-radius: var(--basis-radius-md);
    overflow-x: auto;
    padding: var(--basis-unit-md);

    code {
      color: inherit;
      font-family: 'Fira Code', monospace;
      font-variant-ligatures: contextual;
    }
  }

  ul:not(.component):not([role]) {
    list-style: disc;
    padding-left: 0;

    > li:not(.component) {
      margin: .5em 0 0 2em;
    }
  }

  b, strong {
    font-weight: 600;
  }

  i, em {
    font-style: italic;
  }

  :is(a):link,
  :is(a):visited {
    color: var(--basis-color-primary);
  }
`)

style('basis:prose:spacing', css`
  /* stylelint-disable basis/no-avoidable-nesting -- keep the directive's flat prose selectors */
  :where(
    h1, h2, h3, h4, h5, h6,
    p, ul, ol, dl, blockquote, pre, figure
  ) + :where(
    h1, h2, h3, h4, h5, h6,
    p, ul, ol, dl, blockquote, pre, figure
  ) {
    margin-top: .5em;
  }

  :where(
    h1, h2, h3, h4, h5, h6,
    p, ul, ol, dl, blockquote, pre, figure
  ) + :where(h1, h2, h3, h4, h5, h6) {
    padding-top: .5em;
  }
`)
