import { css, style } from '../../utilities/style'

import.meta.hot.accept()

/*
 * See Button.styles.ts: component tokens use `var(..., default)` fallbacks so
 * they resolve against the element's inherited theme rather than the root.
 */
style('basis:number-editor', css`
  .number-editor.component {
    background: var(--basis-number-editor-background, var(--basis-color-background));
    border-radius: var(--basis-number-editor-border-radius, var(--basis-radius-sm));
    border: var(--basis-number-editor-border, 1px solid var(--basis-color-foreground));
    color: var(--basis-number-editor-foreground, var(--basis-color-foreground));
    display: flex;
    font-size: 1em;
    gap: 0;
    line-height: 1em;
    min-height: 1.5em;
    overflow: hidden;
    padding: 0;
    position: relative;

    > .value {
      background: transparent;
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
    }
  }
`)
