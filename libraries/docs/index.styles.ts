import { css, style } from '@basis/react'

export const docsStyles = style('basis:docs:index', css`
  main {
    h1 { border-bottom: 2px solid var(--basis-color-primary); }

    b, strong {
      font-weight: 600;
    }
    i, em { font-style: italic; }

    code:not(.code.component code) {
      font-family: 'Fira Code', monospace;
      font-variant-ligatures: contextual;
      font-weight: bold;
    }

    p {
      margin: 1em 0;

      &:first-child { margin-top: 0; }
      &:last-child { margin-bottom: 0; }
    }

    ul {
      list-style: disc;
      padding-left: 0;

      > li {
        margin: 0.25em 0 0 2em;
      }
    }
  }
`)
