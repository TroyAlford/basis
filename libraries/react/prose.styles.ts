import { css, style } from './utilities/style'

/**
 * Basis's prose reset: the default treatment for ordinary HTML content.
 *
 * This is intentionally global rather than tied to the documentation shell.
 * Prose can live in an article, aside, section, or any other container and
 * should look the same without that container opting in.
 */
style('basis:prose', css`
  *, *::before, *::after {
    box-sizing: border-box;
  }

  html, body, h1, h2, h3, h4, h5, h6 {
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
    background-color: var(--basis-color-surface-code) !important;
    border-radius: var(--basis-radius-md);
    overflow-x: auto;
    padding: var(--basis-unit-md);

    code {
      color: inherit;
      font-family: 'Fira Code', monospace;
      font-variant-ligatures: contextual;
    }
  }

  ul {
    list-style: disc;
    padding-left: 0;

    > li {
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
  :is(
    h1, h2, h3, h4, h5, h6,
    p, ul, ol, dl, blockquote, pre, table, figure, section
  ) {
    + :is(
    h1, h2, h3, h4, h5, h6,
    p, ul, ol, dl, blockquote, pre, table, figure, section
  ) {
      margin-top: .5em;
    }
    + :is(h1, h2, h3, h4, h5, h6) {
      padding-top: .5em;
    }
  }
`)
