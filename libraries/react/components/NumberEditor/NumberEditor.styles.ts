import { css, style } from '../../utilities/style'

export const NumberEditorStyles = style('basis:number-editor', css`
  :root {
    --basis-number-editor-background: var(--basis-color-background);
    --basis-number-editor-foreground: var(--basis-color-foreground);
    --basis-number-editor-border: 1px solid var(--basis-color-foreground);
    --basis-number-editor-border-radius: var(--basis-radius-sm);
  }

  .number-editor.component {
    align-items: center;
    border-radius: var(--basis-number-editor-border-radius);
    border: var(--basis-number-editor-border);
    display: flex;
    font-size: 1em;
    height: 1.5em;
    line-height: 1em;
    overflow: hidden;
    padding: .25em;

    > .value {
      border: none;
      flex-grow: 1;
      font-size: inherit;
      height: 100%;
      line-height: inherit;
      margin: 0;
      padding: 1px .25em 0 .25em;
    }
  }
`)
