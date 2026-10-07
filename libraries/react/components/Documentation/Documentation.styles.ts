import { css, style } from '../../utilities/style'
import { DOCUMENTATION_FONTS_URL, documentationStyles } from './typography'

style('basis:documentation', css`
  @import url('${DOCUMENTATION_FONTS_URL}');

  ${documentationStyles}

  .documentation.component {
    display: grid;
    grid-template-areas: 'nav main';
    grid-template-columns: 200px 1fr;
    height: 100vh;
    overflow: hidden;
    width: 100vw;

    > nav.links {
      background: #eee;
      border-right: 1px solid #e9ecef;
      flex-shrink: 0;
      grid-area: nav;
      overflow-y: auto;
      width: 200px;

      > h1 {
        background-color: var(--basis-color-foreground);
        color: var(--basis-color-background);
        font-size: var(--basis-font-size-xxl);
        margin: 0;
        padding: var(--basis-unit-md);
      }

      ul, li { list-style: none; margin: 0; padding: 0; }

      li > a {
        display: block;
        padding: var(--basis-unit-sm) var(--basis-unit-md);
        text-decoration: none;

        &[data-active='true'] {
          background-color: var(--basis-color-background);
          color: var(--basis-color-primary);
        }
      }

      li > ul > li { padding-left: var(--basis-unit-md); }
    }

    > main { grid-area: main; overflow: auto; padding: var(--basis-unit-md); }
  }

  main {
    h1 { border-bottom: 2px solid var(--basis-color-primary); }
    b, strong { font-weight: 600; }
    i, em { font-style: italic; }

    code {
      color: green;
      font-family: 'Fira Code', monospace;
      font-variant-ligatures: contextual;
      font-weight: 500;
    }

    p {
      margin: 0;
      &:first-child { margin-top: 0; }
      &:last-child { margin-bottom: 0; }
    }

    select { padding: 0.5rem; width: 100%; }

    ul {
      list-style: disc;
      margin: 0;
      padding-left: 0;
      > li { margin: 0.25em 0 0 2em; }
    }
  }
`)
