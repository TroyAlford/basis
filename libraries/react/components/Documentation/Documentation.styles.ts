import { css, style } from '../../utilities/style'

style('basis:documentation', css`
  .documentation-shell.component {
    background-color: var(--basis-color-background);
    color: var(--basis-color-foreground);
    display: grid;
    font-family: 'Ubuntu', sans-serif;
    font-size: var(--basis-font-size-md);
    grid-template-areas: 'nav main';
    grid-template-columns: 200px 1fr;
    height: 100vh;
    overflow: hidden;
    width: 100vw;
    > nav.links {
      background: var(--basis-color-surface-muted);
      border-right: 1px solid var(--basis-color-border-subtle);
      color: var(--basis-color-foreground);
      display: flex;
      flex-direction: column;
      grid-area: nav;
      overflow: hidden;
      width: 200px;
      > h1 {
        align-items: center;
        background-color: var(--basis-color-surface);
        border-bottom: 1px solid var(--basis-color-border-subtle);
        color: var(--basis-color-foreground);
        display: flex;
        flex: 0 0 auto;
        font-size: var(--basis-font-size-xxl);
        gap: var(--basis-unit-sm);
        margin: 0;
        padding: var(--basis-unit-md);
        > svg {
          flex: 0 0 auto;
        }
      }
      > .entries {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
      }
      li {
        > a {
          color: var(--basis-color-foreground);
          display: block;
          padding: var(--basis-unit-sm) var(--basis-unit-md);
          text-decoration: none;
          &:hover {
            background-color: var(--basis-color-hover);
          }
          &[data-active='true'] {
            background-color: var(--basis-color-background);
            color: var(--basis-color-primary);
          }
        }
        > .section-title {
          color: var(--basis-color-foreground-muted);
          display: block;
          font-size: var(--basis-font-size-sm);
          font-weight: 600;
          letter-spacing: 0.04em;
          margin: 0;
          padding: var(--basis-unit-md) var(--basis-unit-md) var(--basis-unit-xs);
          text-transform: uppercase;
        }
        > ul > li {
          padding-left: var(--basis-unit-md);
        }
      }
      ul, li {
        list-style: none;
        margin: 0;
        padding: 0;
      }
    }
    > main {
      grid-area: main;
      overflow: auto;
      padding: var(--basis-unit-md);
    }
    main {
      h1 {
        border-bottom: 2px solid var(--basis-color-primary);
      }
      code {
        color: var(--basis-color-success);
        font-family: 'Fira Code', monospace;
        font-variant-ligatures: contextual;
        font-weight: 500;
      }
      p {
        margin: 0;
        &:first-child {
          margin-top: 0;
        }
        &:last-child {
          margin-bottom: 0;
        }
      }
      select, input:not(.value):not([type='checkbox']):not([type='radio']):not([type='range']) {
        background-color: var(--basis-color-surface);
        border: 1px solid var(--basis-color-border);
        border-radius: var(--basis-radius-sm);
        color: var(--basis-color-foreground);
      }
      select {
        padding: 0.5rem;
        width: 100%;
      }
      input:not(.value):not([type='checkbox']):not([type='radio']):not([type='range']) {
        padding: .25em .5em;
      }
      ul {
        list-style: disc;
        margin: 0;
        padding-left: 0;
        > li {
          margin: 0.25em 0 0 2em;
        }
      }
      b, strong {
        font-weight: 600;
      }
      i, em {
        font-style: italic;
      }
    }
  }
`)
