import { css, style } from '../../utilities/style'

style('basis:text-editor', css`
  :root {
    --basis-text-editor-background: var(--basis-color-background);
    --basis-text-editor-foreground: var(--basis-color-foreground);
    --basis-text-editor-border: 1px solid var(--basis-color-foreground);
    --basis-text-editor-border-radius: var(--basis-radius-sm);
  }

  .text-editor.component {
    align-items: center;
    border-radius: var(--basis-text-editor-border-radius);
    border: var(--basis-text-editor-border);
    display: flex;
    font-size: 1em;
    line-height: 1em;
    min-height: 1.5em;
    overflow: hidden;
    padding: .25em;
    position: relative;


    > .prefix, > .suffix {
      align-self: flex-start;
    }

    > .value {
      border: none;
      flex-grow: 1;
      font-size: inherit;
      resize: none;
    }

    &::before { padding: 0; }

    > .value, &::before {
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      margin: 0;
      padding: .25em;
      white-space: pre-wrap;
    }

    &[data-multiline="true"] {
      > .value {
        display: flex;
        overflow: auto;
      }
    }

    &[data-multiline="auto"] {
      &::before {
        content: attr(data-value) ' ';
        inset: 1px; // account for the border
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
