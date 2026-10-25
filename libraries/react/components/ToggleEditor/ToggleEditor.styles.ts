import { css, style } from '../../utilities/style'

style('basis:toggle-editor', css`
  .toggle.editor {
    align-items: center;
    background-color: var(--basis-toggle-background, var(--basis-color-surface));
    border: 1px solid var(--basis-toggle-border-color, var(--basis-color-border-subtle));
    border-radius: var(--basis-toggle-border-radius, var(--basis-radius-sm));
    color: var(--basis-toggle-foreground, var(--basis-color-foreground));
    cursor: pointer;
    display: inline-flex;
    gap: 0.25em;
    padding: 0.5em;
    transition: background-color 0.15s ease;
    user-select: none;

    &:hover:not(:disabled) {
      background-color: var(--basis-toggle-background-hover, var(--basis-color-hover));
    }

    &:focus-visible {
      outline: 2px solid var(--basis-color-focus);
      outline-offset: 1px;
    }

    &[data-state="on"] {
      background-color: var(--basis-toggle-background-on, var(--basis-color-primary));
      color: var(--basis-color-contrast);
    }

    &:disabled, &[disabled] {
      background-color: var(--basis-color-disabled);
      color: var(--basis-color-disabled-text);
      cursor: default;
    }
  }
`)
