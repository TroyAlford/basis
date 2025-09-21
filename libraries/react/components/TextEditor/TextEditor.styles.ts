import { css, style } from '../../utilities/style'

style('basis:text-editor', css`
  :root {
    --basis-text-editor-background: var(--basis-color-background);
    --basis-text-editor-border-radius: var(--basis-radius-sm);
    --basis-text-editor-border: 1px solid var(--basis-color-foreground);
    --basis-text-editor-foreground: var(--basis-color-foreground);
    --basis-text-editor-padding: var(--basis-unit-xs);
  }

  .text-editor.component {
    border-radius: var(--basis-text-editor-border-radius);
    border: var(--basis-text-editor-border);
    display: flex;
    font-size: 1em;
    gap: var(--basis-text-editor-padding);
    line-height: 1em;
    min-height: 1.5em;
    overflow: hidden;
    padding: var(--basis-text-editor-padding);
    position: relative;


    > .value, &::before {
      border: none;
      flex-grow: 1;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      margin: var(--basis-text-editor-padding);
      padding: 0;
      resize: none;
      white-space: pre-wrap;
    }
    
    &[data-multiline="true"] > .value {
      display: flex;
      overflow: auto;
    }

    &[data-multiline="auto"] {
      &::before {
        content: attr(data-value) ' ';
        visibility: hidden;
      }

      > .prefix, > .suffix {
        display: none;
      }

      > .value {
        inset: 0;
        overflow: hidden;
        padding: inherit;
        position: absolute;
      }
    }
  }
`)
