import { css, style } from '../../utilities/style'

import.meta.hot.accept()

style('basis:number-editor', css`
  :root {
    --basis-number-editor-background: var(--basis-color-background);
    --basis-number-editor-border-radius: var(--basis-radius-sm);
    --basis-number-editor-border: 1px solid var(--basis-color-foreground);
    --basis-number-editor-foreground: var(--basis-color-foreground);
    --basis-number-editor-padding: var(--basis-unit-xs);
  }

  .number-editor.component {
    border-radius: var(--basis-number-editor-border-radius);
    border: var(--basis-number-editor-border);
    display: flex;
    font-size: 1em;
    gap: var(--basis-number-editor-padding);
    line-height: 1em;
    min-height: 1.5em;
    overflow: hidden;
    padding: var(--basis-number-editor-padding);
    position: relative;

    > .value {
      border: none;
      flex-grow: 1;
      font-family: inherit;
      font-size: inherit;
      height: 100%;
      line-height: inherit;
      margin: var(--basis-number-editor-padding);
      padding: 0;
      text-align: right;
    }
  }
`)
