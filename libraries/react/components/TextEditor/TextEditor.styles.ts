import { css, style } from '../../utilities/style'

style('basis:text-editor', css`
  .text-editor.component {
    background-color: var(--basis-text-editor-background, var(--basis-color-surface));
    border:
      var(--basis-text-editor-border,
        1px solid var(--basis-text-editor-border-color, var(--basis-color-border)));
    border-radius: var(--basis-text-editor-border-radius, var(--basis-radius-sm));
    color: var(--basis-text-editor-foreground, var(--basis-color-foreground));
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

    > .value, &::before {
      background-color: transparent;
      border: none;
      color: inherit;
      flex-grow: 1;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      margin: 0;
      outline: none;
      padding: var(--basis-text-editor-padding, var(--basis-unit-xs));
      resize: none;
      white-space: pre-wrap;
    }

    > .value {
      &::selection {
        background-color: var(--basis-color-selection);
        color: var(--basis-color-foreground);
      }
      &::placeholder {
        color: var(--basis-color-foreground-muted);
        opacity: 1;
      }
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
