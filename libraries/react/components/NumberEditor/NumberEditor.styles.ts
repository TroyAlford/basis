import { css, style } from '../../utilities/style'

import.meta.hot.accept()

style('basis:number-editor', css`
  .number-editor.component {
    background-color: var(--basis-number-editor-background, var(--basis-color-surface));
    border:
      var(--basis-number-editor-border,
        1px solid var(--basis-number-editor-border-color, var(--basis-color-border)));
    border-radius: var(--basis-number-editor-border-radius, var(--basis-radius-sm));
    color: var(--basis-number-editor-foreground, var(--basis-color-foreground));
    display: flex;
    font-size: 1em;
    gap: 0;
    line-height: 1em;
    min-height: 1.5em;
    overflow: hidden;
    padding: 0;
    position: relative;

    &:focus-within {
      border-color: var(--basis-color-focus);
    }

    > .value {
      background-color: transparent;
      border: none;
      color: inherit;
      flex-grow: 1;
      font-family: inherit;
      font-size: inherit;
      height: 100%;
      line-height: inherit;
      margin: 0;
      outline: none;
      padding: var(--basis-number-editor-padding, var(--basis-unit-xs));
      text-align: right;
      &::selection {
        background-color: var(--basis-color-selection);
        color: var(--basis-color-foreground);
      }
    }
  }
`)
